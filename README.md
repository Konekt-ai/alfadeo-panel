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

## Desplegar en Vercel

1. **Importar el repo** en [vercel.com/new](https://vercel.com/new). Detecta
   Next.js solo; no hay que tocar los comandos de build.
2. **Settings → Environment Variables**, agrega las dos de arriba en
   *Production* (y en *Preview* si quieres que los previews funcionen).
3. **Deploy.**

El panel queda accesible para cualquiera que tenga la URL. Si más adelante
quieren restringirlo, en `PENDIENTES.md` están las opciones.

### Nota sobre `output: 'standalone'`

Está apagado por defecto y sólo se activa con `BUILD_STANDALONE=1`, que pone el
`Dockerfile`. Vercel arma su propio bundle y no lo necesita; además, con
standalone encendido `next start` no funciona.

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
