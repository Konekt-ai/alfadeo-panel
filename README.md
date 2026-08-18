# ALFA-DEO — Panel interno

Panel de gestión comercial para **Alianza Farmacéutica DEO**. Administra
solicitudes de abastecimiento, clientes, inventario, proveedores y cotizaciones.

El bot de WhatsApp que alimenta las solicitudes vive en un repo aparte
(`alfadeo-bot`) y comparte la misma base de datos.

## Stack

- **Next.js 14** (App Router, Server Components, Server Actions)
- **Tailwind CSS v4**
- **Supabase** (PostgreSQL)

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
| `SUPABASE_URL` | URL del proyecto en Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key. **No** la anon key. Sólo servidor |

## La computadora del mostrador

El panel corre **en la computadora de la empresa**, no en la nube. La base
sigue siendo Supabase, así que de todos modos necesita internet; lo único
local es el servidor web.

### Instalarlo

Todo lo necesario está en **[instalacion/](instalacion/)**. En resumen:

```powershell
git clone https://github.com/Konekt-ai/alfadeo-panel.git C:\alfadeo\panel
cd C:\alfadeo\panel
powershell -ExecutionPolicy Bypass -File instalacion\instalar.ps1
```

El instalador baja Node portable, pide las llaves de Supabase, verifica que
la base tenga las migraciones, compila, registra el arranque automático, abre
el puerto y deja los accesos en el escritorio. Es idempotente: volver a
correrlo repara sin romper nada.

Los pasos completos, los comandos del día a día y qué hacer cuando algo falla
están en **[instalacion/LEEME.md](instalacion/LEEME.md)**.

### Publicar cambios

Programas aquí, pruebas en local, commiteas y empujas. Luego entras por SSH y
corres un comando:

```bash
ssh DELL@192.168.1.116
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

**Decisión tomada:** el panel vive sólo en la computadora de la empresa. No
se publica en internet.

Estuvo un tiempo en Vercel, pero era para enseñarle avances al cliente, no
para operar. Ya se dio de baja.

Lo único que sale a internet es la conexión a Supabase, que es saliente: nadie
entra desde fuera.

### Nota sobre `output: 'standalone'`

Está apagado por defecto y sólo se activa con `BUILD_STANDALONE=1`, que pone
el `Dockerfile`. Con standalone encendido `next start` no funciona, y es
justo lo que usa la computadora del mostrador — así que déjalo apagado.

## Base de datos

El esquema **no vive en este repositorio** (`.gitignore` excluye los `.sql`).
Los archivos están en `supabase/` en local. Ver `PENDIENTES.md`, sección
"Seguridad", para saber dónde respaldarlos.

Migraciones, **en este orden**:

1. `cotizador-inteligente.sql` — proveedores, precios, matching y márgenes
2. `reunion-catalogo-sucursales.sql` — catálogo farmacéutico desglosado,
   sucursales GDL/MTY, existencia por plaza y campos de facturación
3. `reunion-operacion.sql` — lotes, kardex, punto de venta, cobranza,
   traslados y compras

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
