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

| | |
| --- | --- |
| Equipo | `DESKTOP-17PH81O` · Windows 10 22H2 |
| En esa máquina | `http://localhost:3002` |
| Desde el WiFi de la oficina | `http://192.168.1.116:3002` |
| Todo vive en | `C:\alfadeo` |
| Log del servidor | `C:\alfadeo\panel.log` (se rota solo a los 5 MB) |

```text
C:\alfadeo\
  node\               Node LTS portable
  git\                Git portable
  panel\              este repo, clonado
  iniciar-panel.ps1   lo que corre la tarea programada
  actualizar.cmd      traer cambios y reiniciar
  estado.cmd          diagnostico
  reiniciar.cmd       reiniciar sin traer cambios
  log.cmd             ultimas lineas del log
  prueba-lector.html  probar el lector sin el sistema arriba
```

Node y Git van **portables** porque `winget` está roto en esa máquina y los
instaladores piden elevación. Se quitan borrando la carpeta.

### Publicar cambios

El ciclo completo: programas aquí, pruebas en local, commiteas y empujas.
Luego entras por SSH y corres **un comando**.

```bash
ssh DELL@192.168.1.116
estado        # ¿está arriba? ¿en qué commit? ¿hay algo nuevo en GitHub?
actualizar    # traer, recompilar y reiniciar
```

| Comando | Qué hace |
| --- | --- |
| `estado` | Si responde, en qué commit está, si GitHub tiene commits nuevos, cómo está la tarea de arranque |
| `actualizar` | `git fetch` → `reset --hard` → `npm ci` (sólo si cambió el lockfile) → `build` → reiniciar |
| `actualizar -Forzar` | Igual, pero recompila aunque no haya nada nuevo |
| `reiniciar` | Reiniciar sin traer cambios |
| `log` | Últimas 40 líneas de `panel.log` |

Tres cosas que hace bien y conviene saber:

- **Si no hay nada nuevo, no toca nada.** No tiene caso tumbar la caja para
  recompilar lo mismo.
- **Compila antes de reiniciar.** Si empujas algo que no compila, el
  mostrador se queda con la versión anterior y el comando te dice por qué
  falló. Probado: el servidor conserva hasta el mismo PID.
- **Usa `reset --hard`, nunca `pull`.** Esa máquina es un destino de
  despliegue, no un lugar donde se programa: así no puede quedar un conflicto
  de merge a media mañana. Si alguien editó archivos ahí, los enumera antes
  de descartarlos.

Y usa `npm ci`, no `npm install`: instala exacto desde el lockfile y no lo
reescribe. Con `install`, el npm de esa máquina ensuciaba el repo en cada
actualización.

### Arranque

Una tarea programada, **ALFA-DEO Panel**, lo levanta **al prender la
computadora**, corriendo como `SYSTEM`. No hace falta que nadie inicie sesión
— importa porque la administración es por SSH. Verificado con un reinicio
real: volvió sola en 20 segundos.

También se dispara al iniciar sesión, por si alguien la apagó a mano. El
script de arranque revisa primero si el puerto ya está ocupado, así que
dispararla dos veces no levanta dos servidores.

Se lanza `next start` directo con node, no `npm run start`: npm mete un
`cmd.exe` de por medio y luego el proceso hijo queda huérfano ocupando el
puerto.

Corre el **build de producción**, no `next dev`. En dev cada visita recompila
y el mostrador lo sentiría lento.

### Red

El puerto 3002 está abierto en el firewall para perfiles **Privado** y de
dominio, y la WiFi de la oficina se marcó como Privada — venía como Pública,
y en ese perfil Windows bloquea todo lo entrante.

La IP viene de DHCP. Si el módem se la cambia, los celulares dejan de entrar:
conviene reservarla en el router.

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
