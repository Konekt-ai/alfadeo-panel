# ALFA-DEO — Panel interno

Panel de gestión comercial para **Alianza Farmacéutica DEO**. Administra
solicitudes de abastecimiento, clientes, inventario, proveedores y cotizaciones.

El bot de WhatsApp que alimenta las solicitudes vive en un repo aparte
(`alfadeo-bot`).

> **Ojo con el bot.** Compartía la base con el panel cuando ésta vivía en
> Supabase. Ahora la base es local y sólo escucha en `localhost`, así que el
> bot ya no la alcanza. Hay que decidir cómo se reconecta antes de darlo por
> funcionando.

## Stack

- **Next.js 14** (App Router, Server Components, Server Actions)
- **Tailwind CSS v4**
- **PostgreSQL**, corriendo en la misma computadora que el panel

## Vistas

### Operación diaria

| Ruta | Descripción |
| --- | --- |
| `/inicio` | Tablero: pendientes de cobranza, caducidades, reorden y números del día |
| `/pos` | Punto de venta. Busca por nombre o escaneando, descuenta el lote que caduca antes y aplica el IVA de cada producto |
| `/movimientos` | Kardex de entradas, salidas y ajustes, firmado por quien lo hizo |
| `/traslados` | Traslados Guadalajara ↔ Monterrey: un documento, dos movimientos |
| `/compras` | Captura de compras al recibir mercancía, con lectura del CFDI del proveedor |

### Comercial y administración

| Ruta | Descripción |
| --- | --- |
| `/solicitudes` | Solicitudes con filtros por estado, canal y atención requerida |
| `/solicitudes/[id]` | Detalle con datos del cliente e items |
| `/solicitudes/[id]/cotizar` | Cotizador con sugerencia de proveedor y márgenes |
| `/ventas` · `/ventas/[id]` | Estado de cada venta: partidas, lotes, factura, pagos y saldo |
| `/cobranza` | Adeudos por cliente, alertas de vencidos y registro de pagos |
| `/cobranza/[clienteId]` | Estado de cuenta del cliente |
| `/clientes` | Directorio de clientes |

### Catálogo

| Ruta | Descripción |
| --- | --- |
| `/inventario` | Catálogo: comercial, genérico, miligramos, presentación, lote, caducidad y plaza |
| `/inventario/nuevo` · `/inventario/[id]` | Alta y edición |
| `/verificador` | Escanea una caja: si el código ya está, muestra el medicamento en grande; si no, se busca por nombre y queda ligado |
| `/inventario/importar` | Importa el catálogo de Aspel, con los códigos de barras que necesita el POS |
| `/proveedores` · `/proveedores/[id]` | Proveedores e importación de listas de precios |

## Cómo se mueve el inventario

Una fila de `inventario` **es un lote**: producto + plaza + lote + ubicación.
El mismo medicamento aparece varias veces, una por caducidad.

Nadie escribe `inventario.existencia` a mano. Toda variación pasa por
`registrar_movimiento()`, que bloquea la fila, valida que no quede en negativo
y deja el asiento en `movimientos_inventario`. Por eso dos personas pueden
vender el mismo producto al mismo tiempo sin pisarse.

Las salidas usan **FEFO**: sale primero el lote que caduca antes.

Quien opera el panel se elige en el header y viaja firmado en cada movimiento.
No es autenticación — el panel sigue sin login — es trazabilidad.

## Correr en local

```bash
npm install
cp .env.example .env.local     # PowerShell: Copy-Item .env.example .env.local
npm run dev                    # http://localhost:3002
```

## Variables de entorno

| Variable | Para qué |
| --- | --- |
| `DATABASE_URL` | Conexión a PostgreSQL. La escribe sola `instalacion\instalar-postgres.ps1` |

## La computadora del mostrador

**Todo** corre en la computadora de la empresa: el panel y la base. No sale
nada a internet — PostgreSQL escucha sólo en `localhost` y el panel sólo se
alcanza desde la red de la oficina.

### Instalarlo

Todo lo necesario está en **[instalacion/](instalacion/)**. En resumen:

```powershell
git clone https://github.com/Konekt-ai/alfadeo-panel.git C:\alfadeo\panel
cd C:\alfadeo\panel
powershell -ExecutionPolicy Bypass -File instalacion\instalar.ps1
```

El instalador baja Node y PostgreSQL portables, crea la base, corre las
migraciones, compila, registra el arranque automático y el respaldo diario,
abre el puerto y deja los accesos en el escritorio. Es idempotente: volver a
correrlo repara sin romper nada.

Los pasos completos, los comandos del día a día y qué hacer cuando algo falla
están en **[instalacion/LEEME.md](instalacion/LEEME.md)**.

### Publicar cambios

Programas aquí, pruebas en local, commiteas y empujas. Luego entras por SSH y
corres un comando:

```bash
ssh DELL@<ip-de-la-maquina>    # la dice `estado`, o ipconfig en esa compu
estado        # ¿está arriba? ¿en qué commit? ¿hay algo nuevo?
actualizar    # traer, recompilar y reiniciar
```

`actualizar` no toca nada si no hay commits nuevos, compila **antes** de
reiniciar —si empujas algo que no compila, el mostrador sigue con la versión
anterior— y usa `reset --hard`, nunca `pull`, para que no pueda quedar un
conflicto de merge a media mañana.

### Dónde queda

| | |
| --- | --- |
| En esa máquina | `http://localhost:3002` |
| Desde el WiFi de la oficina | `http://<ip>:3002` |
| Todo vive en | `C:\alfadeo` |
| Log del servidor | `C:\alfadeo\panel.log` (se rota solo a los 5 MB) |

Node y Git van **portables** porque `winget` puede estar roto y los
instaladores piden elevación. Se quitan borrando la carpeta.

La tarea de arranque corre como `SYSTEM` **al prender la computadora**, no al
iniciar sesión: si reinicias en remoto y nadie entra al escritorio, el panel
sube igual.

## No va en la nube

**Decisión tomada:** el panel y la base viven sólo en la computadora de la
empresa. No se publica nada en internet.

Estuvo un tiempo en Vercel con la base en Supabase, pero era para enseñarle
avances al cliente, no para operar. Las dos cosas ya se quitaron.

Lo que eso implica y hay que tener presente:

- **Los respaldos son responsabilidad de la casa.** Supabase respaldaba solo;
  un escritorio no. Hay una tarea diaria a la 1:00 (`instalacion/respaldo.ps1`)
  que conserva 14 diarios y el primero de cada mes. **Apúntala a otro disco o
  a una carpeta que se sincronice**: un respaldo en el mismo disco no salva de
  un disco muerto.
- **Si esa computadora se apaga, no hay sistema.** No hay segunda copia.

### Nota sobre `output: 'standalone'`

Está apagado por defecto y sólo se activa con `BUILD_STANDALONE=1`, que pone
el `Dockerfile`. Con standalone encendido `next start` no funciona, y es
justo lo que usa la computadora del mostrador — así que déjalo apagado.

## Base de datos

El esquema **no vive en este repositorio** (`.gitignore` excluye los `.sql`).
Los archivos están en `supabase/` en local. Ver `PENDIENTES.md`, sección
"Seguridad", para saber dónde respaldarlos.

Migraciones, **en este orden** (las corre `instalacion\instalar-base.ps1`):

1. `00-esquema-base.sql` — catálogo, inventario, clientes, solicitudes y
   cotizaciones. Se reconstruyó a partir del esquema que ya corría en
   producción: el `.sql` del arranque del proyecto se había perdido
2. `cotizador-inteligente.sql` — proveedores, precios, matching y márgenes
3. `reunion-catalogo-sucursales.sql` — catálogo farmacéutico desglosado,
   sucursales GDL/MTY, existencia por plaza y campos de facturación
4. `reunion-operacion.sql` — lotes, kardex, punto de venta, cobranza,
   traslados y compras
5. `99-llaves-foraneas.sql` — al final porque cruzan migraciones

Las tres son aditivas e idempotentes: se pueden volver a correr sin romper
nada. La tercera avisa por `notice` si encuentra lotes duplicados en lugar
de fallar.

Después de correr la tercera, da de alta a las personas que van a operar:

```sql
insert into usuarios_panel (nombre, rol) values
  ('Ana',    'ventas'),
  ('Carlos', 'almacen'),
  ('Diego',  'admin');
```

## Carga inicial de inventario

```bash
pip install pdfplumber supabase
python3 scripts/seed-inventario.py ruta/al/inventario.pdf
```

Parsea Marca, Producto, Laboratorio, Lote, Caducidad, Piezas y Ubicación, e
inserta en `productos` e `inventario`.

## Qué falta

Ver **[PENDIENTES.md](PENDIENTES.md)**: estado de los 39 puntos de la reunión,
ordenados por prioridad.
