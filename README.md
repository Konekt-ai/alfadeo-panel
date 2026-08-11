# ALFA-DEO — Panel interno

Panel de gestión comercial para **Alianza Farmacéutica DEO**. Administra
solicitudes de abastecimiento, clientes, inventario, proveedores y cotizaciones.

El bot de WhatsApp que alimenta las solicitudes vive en un repo aparte
(`alfadeo-bot`) y comparte la misma base de datos.

> **Antes de publicarlo:** el panel consulta Supabase con la *service role key*,
> que salta todas las políticas RLS. Sin `PANEL_PASSWORD` configurada, cualquiera
> con la URL vería inventario, clientes y adeudos. Por eso en producción el panel
> responde 503 mientras esa variable no exista.

## Stack

- **Next.js 14** (App Router, Server Components, Server Actions)
- **Tailwind CSS v4**
- **Supabase** (PostgreSQL)

## Vistas

| Ruta | Descripción |
| --- | --- |
| `/solicitudes` | Solicitudes con filtros por estado, canal y atención requerida |
| `/solicitudes/[id]` | Detalle con datos del cliente e items |
| `/solicitudes/[id]/cotizar` | Cotizador con sugerencia de proveedor y márgenes |
| `/clientes` | Directorio de clientes |
| `/inventario` | Catálogo: comercial, genérico, miligramos, presentación, lote, caducidad y plaza |
| `/inventario/nuevo` · `/inventario/[id]` | Alta y edición |
| `/proveedores` · `/proveedores/[id]` | Proveedores e importación de listas de precios |
| `/login` | Puerta de acceso |

## Correr en local

```bash
npm install
cp .env.example .env.local     # PowerShell: Copy-Item .env.example .env.local
npm run dev                    # http://localhost:3002
```

En desarrollo, si `PANEL_PASSWORD` está vacía no se pide contraseña.

## Variables de entorno

| Variable | Para qué |
| --- | --- |
| `SUPABASE_URL` | URL del proyecto en Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key. **No** la anon key. Sólo servidor |
| `PANEL_PASSWORD` | Contraseña compartida de acceso. **Obligatoria en producción** |

## Desplegar en Vercel

1. **Importar el repo** en [vercel.com/new](https://vercel.com/new). Detecta
   Next.js solo; no hay que tocar los comandos de build.
2. **Settings → Environment Variables**, agrega las tres de arriba en
   *Production* (y en *Preview* si quieres que los previews funcionen).
3. **Deploy.**
4. Abre la URL: debe pedir contraseña. Si en vez de eso sale
   *"Falta configurar el acceso"*, falta `PANEL_PASSWORD` — agrégala y vuelve a
   desplegar.

### Nota sobre `output: 'standalone'`

Está apagado por defecto y sólo se activa con `BUILD_STANDALONE=1`, que pone el
`Dockerfile`. Vercel arma su propio bundle y no lo necesita; además, con
standalone encendido `next start` no funciona.

## Base de datos

El esquema **no vive en este repositorio** (`.gitignore` excluye los `.sql`).
Los archivos están en `supabase/` en local. Ver `PENDIENTES.md`, sección
"Seguridad", para saber dónde respaldarlos.

Migraciones aplicadas:

- `cotizador-inteligente.sql` — proveedores, precios, matching y márgenes
- `reunion-catalogo-sucursales.sql` — catálogo farmacéutico desglosado,
  sucursales GDL/MTY, existencia por plaza y campos de facturación

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
