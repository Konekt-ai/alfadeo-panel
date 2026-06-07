# ALFA-DEO — Panel interno

Panel de gestión comercial para **Alianza Farmacéutica DEO**. Permite administrar solicitudes de abastecimiento, clientes e inventario.

## Stack

- **Next.js 14** (App Router, Server Components, Server Actions)
- **Tailwind CSS v4**
- **Supabase** (PostgreSQL)

## Vistas

| Ruta | Descripción |
|------|-------------|
| `/solicitudes` | Lista de solicitudes con filtros por estado, canal y atención requerida |
| `/solicitudes/[id]` | Detalle de solicitud con datos del cliente e items |
| `/clientes` | Directorio de clientes registrados |
| `/inventario` | Catálogo de productos con existencias, lotes y caducidades |
| `/inventario/nuevo` | Agregar producto al inventario |
| `/inventario/[id]` | Editar o eliminar producto |

## Configuración local

1. Clonar el repositorio
2. Instalar dependencias:
   ```bash
   npm install
   ```
3. Crear `.env.local` en la raíz:
   ```
   SUPABASE_URL=https://tu-proyecto.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key
   ```
4. Levantar el servidor de desarrollo:
   ```bash
   npm run dev
   ```
   El panel estará disponible en `http://localhost:3002`.

## Carga inicial de inventario

Para importar el inventario desde el PDF mensual:

```bash
# Instalar dependencias Python
pip install pdfplumber supabase

# Ejecutar el script
python3 scripts/seed-inventario.py ruta/al/inventario.pdf
```

El script parsea las columnas Marca, Producto, Laboratorio, Lote, Caducidad, Piezas y Ubicación, e inserta los registros en las tablas `productos` e `inventario` de Supabase.

## Deploy (Railway)

Variables de entorno requeridas en Railway:

```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

El proyecto incluye `next.config.mjs` con `output: 'standalone'` para compatibilidad con el Dockerfile.
