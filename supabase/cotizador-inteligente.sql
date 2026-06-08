-- =====================================================================
--  ALFA-DEO · Cotizador inteligente B2B (extensión del esquema)
--  Fase 2: precios de proveedores + matching + márgenes + sugeridor
--
--  Es ADITIVO: no modifica las tablas de Fase 1.
--  Asume que ya existen: productos, inventario, clientes, solicitudes,
--  solicitud_items, cotizaciones, cotizacion_items.
--
--  Uso: Supabase → SQL Editor → pega todo → Run.
--
--  SEGURIDAD DE CREDENCIALES:
--    NO se guarda ninguna contraseña de proveedor en texto plano.
--    proveedores.credencial_ref apunta a un secreto en Supabase Vault
--    o a una variable de entorno del worker (Railway). Ver nota al final.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
--  Enums nuevos
-- ---------------------------------------------------------------------
do $$ begin
  create type metodo_ingesta as enum ('manual','import','scrape','api');
exception when duplicate_object then null; end $$;

do $$ begin
  create type estado_match as enum ('pendiente','auto','confirmado','descartado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type origen_precio as enum ('manual','import','scrape','api');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
--  Proveedores
-- ---------------------------------------------------------------------
create table if not exists proveedores (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null,                 -- "Difarmer", "Medicinas Rosario", "Calderón"
  slug            text unique not null,          -- "difarmer", "rosario", "calderon"
  metodo_ingesta  metodo_ingesta not null default 'import',
  portal_url      text,                          -- liga del portal (solo referencia)
  credencial_ref  text,                          -- NOMBRE del secreto en Vault/env, NO la contraseña
  moneda          text default 'MXN',
  dias_entrega    int,                           -- lead time típico, para el sugeridor
  activo          boolean default true,
  notas           text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ---------------------------------------------------------------------
--  Catálogo / precios del proveedor (snapshot vigente, 1 fila por SKU)
--  El histórico se guarda aparte (proveedor_precios_historial).
-- ---------------------------------------------------------------------
create table if not exists proveedor_precios (
  id              uuid primary key default gen_random_uuid(),
  proveedor_id    uuid not null references proveedores(id) on delete cascade,
  sku_proveedor   text,                          -- clave del producto en SU sistema
  codigo_barras   text,                          -- EAN/GTIN si lo dan (clave de oro para matchear)
  nombre_prov     text not null,                 -- nombre tal cual lo nombra el proveedor
  laboratorio     text,
  presentacion    text,
  precio          numeric(12,2),                 -- COSTO para ti (sin IVA salvo que el prov. lo incluya)
  iva_incluido    boolean default false,
  existencia      numeric(12,2),                 -- null = desconocido
  en_stock        boolean,                       -- null = desconocido
  caducidad       date,
  moq             numeric(12,2),                 -- mínimo de compra
  origen          origen_precio not null default 'import',
  fecha_precio    timestamptz default now(),     -- cuándo se capturó este precio
  raw             jsonb,                          -- payload crudo del scrape/import (auditoría)

  -- Matching con tu catálogo:
  producto_id     uuid references productos(id) on delete set null,
  match_estado    estado_match not null default 'pendiente',
  match_score     numeric(4,3),                  -- 0..1 confianza del emparejamiento

  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  unique (proveedor_id, sku_proveedor)
);
create index if not exists idx_pp_proveedor   on proveedor_precios (proveedor_id);
create index if not exists idx_pp_producto     on proveedor_precios (producto_id);
create index if not exists idx_pp_match_estado on proveedor_precios (match_estado);
create index if not exists idx_pp_ean          on proveedor_precios (codigo_barras);
create index if not exists idx_pp_busqueda     on proveedor_precios
  using gin (to_tsvector('spanish', coalesce(nombre_prov,'') || ' ' || coalesce(laboratorio,'')));

-- Histórico de precios (para tendencias y para no perder el dato al actualizar)
create table if not exists proveedor_precios_historial (
  id            bigint generated always as identity primary key,
  proveedor_id  uuid not null references proveedores(id) on delete cascade,
  sku_proveedor text,
  precio        numeric(12,2),
  existencia    numeric(12,2),
  en_stock      boolean,
  fecha_precio  timestamptz default now()
);
create index if not exists idx_pph_busqueda on proveedor_precios_historial (proveedor_id, sku_proveedor, fecha_precio desc);

-- ---------------------------------------------------------------------
--  Códigos de barras de TUS productos (ayuda al matching por EAN)
-- ---------------------------------------------------------------------
create table if not exists producto_codigos (
  id           uuid primary key default gen_random_uuid(),
  producto_id  uuid not null references productos(id) on delete cascade,
  codigo       text not null,                    -- EAN/GTIN/UPC
  tipo         text default 'ean',
  unique (codigo)
);
create index if not exists idx_pc_producto on producto_codigos (producto_id);

-- ---------------------------------------------------------------------
--  Reglas de margen. Se resuelve la regla MÁS específica por prioridad.
--  Scope opcional: por tipo de cliente, categoría y/o producto.
-- ---------------------------------------------------------------------
create table if not exists margenes (
  id            uuid primary key default gen_random_uuid(),
  nombre        text,
  tipo_cliente  tipo_cliente,                    -- null = aplica a todos
  categoria     text,                            -- null = aplica a todas
  producto_id   uuid references productos(id) on delete cascade,  -- null = no específico
  margen_pct    numeric(6,3) not null,           -- 0.18 = 18% sobre costo
  prioridad     int not null default 0,          -- mayor = gana
  activo        boolean default true,
  created_at    timestamptz default now()
);
create index if not exists idx_margenes_lookup on margenes (activo, prioridad desc);

-- ---------------------------------------------------------------------
--  Trazabilidad de costo en la cotización:
--  guardar de DÓNDE salió el precio y con qué margen, para reportes.
-- ---------------------------------------------------------------------
alter table cotizacion_items add column if not exists proveedor_id    uuid references proveedores(id);
alter table cotizacion_items add column if not exists origen_compra   text;          -- 'inventario' | 'proveedor'
alter table cotizacion_items add column if not exists costo_unitario  numeric(12,2); -- lo que te cuesta a ti
alter table cotizacion_items add column if not exists margen_pct      numeric(6,3);  -- margen aplicado

-- ---------------------------------------------------------------------
--  VISTA: opciones de compra por producto (lo que el sugeridor consume)
--  Une tu inventario propio + precios de proveedores ya matcheados.
--  El RANKING final (precio/stock/caducidad/margen) se hace en la app,
--  porque las reglas de negocio van a cambiar. Aquí solo se agregan.
-- ---------------------------------------------------------------------
create or replace view v_opciones_compra as
  -- Opción: inventario propio
  select
    p.id                        as producto_id,
    'inventario'::text          as origen,
    null::uuid                  as proveedor_id,
    'Inventario propio'::text   as fuente_nombre,
    p.precio_base               as costo,        -- costo de referencia interno
    sum(i.existencia)           as existencia,
    (sum(i.existencia) > 0)     as en_stock,
    min(prd.caducidad)          as caducidad,
    null::numeric               as moq,
    now()                       as fecha_precio,
    null::numeric               as match_score
  from productos p
  join inventario i on i.producto_id = p.id
  left join productos prd on prd.id = p.id   -- caducidad vive en productos en tu BD actual
  group by p.id, p.precio_base

  union all

  -- Opción: cada proveedor con precio matcheado y confiable
  select
    pp.producto_id,
    'proveedor'::text,
    pp.proveedor_id,
    pr.nombre,
    pp.precio,
    pp.existencia,
    coalesce(pp.en_stock, pp.existencia > 0),
    pp.caducidad,
    pp.moq,
    pp.fecha_precio,
    pp.match_score
  from proveedor_precios pp
  join proveedores pr on pr.id = pp.proveedor_id
  where pp.producto_id is not null
    and pp.match_estado in ('auto','confirmado')
    and pr.activo;

-- ---------------------------------------------------------------------
--  updated_at automático (reusa set_updated_at() de Fase 1)
-- ---------------------------------------------------------------------
drop trigger if exists trg_proveedores_updated on proveedores;
create trigger trg_proveedores_updated before update on proveedores
  for each row execute function set_updated_at();

drop trigger if exists trg_pp_updated on proveedor_precios;
create trigger trg_pp_updated before update on proveedor_precios
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
--  RLS (igual que Fase 1: bloqueado para anon/auth, service role pasa)
-- ---------------------------------------------------------------------
alter table proveedores                 enable row level security;
alter table proveedor_precios           enable row level security;
alter table proveedor_precios_historial enable row level security;
alter table producto_codigos            enable row level security;
alter table margenes                    enable row level security;

-- ---------------------------------------------------------------------
--  Semilla de los 3 proveedores (sin credenciales en claro)
-- ---------------------------------------------------------------------
insert into proveedores (nombre, slug, metodo_ingesta, portal_url, credencial_ref) values
  ('Difarmer',           'difarmer', 'scrape', null,
     'DIFARMER_CREDS'),
  ('Medicinas Rosario',  'rosario',  'scrape', 'https://e-indigo.com/App/Ordenes.aspx',
     'ROSARIO_CREDS'),
  ('Distribuidora Calderón', 'calderon', 'scrape', 'https://dfcalderon.net/',
     'CALDERON_CREDS')
on conflict (slug) do nothing;

-- =====================================================================
--  NOTA SOBRE CREDENCIALES (hazlo en Supabase Vault):
--
--    select vault.create_secret(
--      '{"usuario":"C17234","password":"<rotar-esta>"}',  -- valor JSON
--      'DIFARMER_CREDS',                                    -- nombre = credencial_ref
--      'Credenciales portal Difarmer'
--    );
--
--  El worker scraper las lee con la service role key vía
--    select decrypted_secret from vault.decrypted_secrets where name = 'DIFARMER_CREDS';
--  Alternativa: variables de entorno en Railway (DIFARMER_USER/DIFARMER_PASS).
--  En ambos casos: ROTA las contraseñas que se compartieron en texto plano.
-- =====================================================================
