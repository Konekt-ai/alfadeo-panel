// Trae los datos de Supabase a la base local. Se corre UNA VEZ, el dia que
// se hace el cambio.
//
//   node instalacion/migrar-datos.mjs
//   node instalacion/migrar-datos.mjs --dry     (solo cuenta, no escribe)
//
// Lee las tres variables de .env.local (o del ambiente):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   -- de donde salen los datos
//   DATABASE_URL                              -- a donde entran
//
// Se baja por la API REST y no con pg_dump porque nunca tuvimos la
// contrasena de Postgres de Supabase, solo la llave de servicio. Para este
// tamano de datos (cientos de renglones) da igual.
//
// Es RE-EJECUTABLE: usa "on conflict do nothing", asi que correrlo dos
// veces no duplica nada. Lo que ya existe en la base local se respeta.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const AQUI  = dirname(fileURLToPath(import.meta.url))
const PANEL = join(AQUI, '..')
const SECO  = process.argv.includes('--dry')

// ------------------------------------------------------------ ambiente ---
function cargarEnv() {
  try {
    for (const linea of readFileSync(join(PANEL, '.env.local'), 'utf8').split(/\r?\n/)) {
      const m = linea.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* si no hay .env.local, se usa el ambiente tal cual */ }
}
cargarEnv()

const SB_URL = process.env.SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const PG_URL = process.env.DATABASE_URL

if (!SB_URL || !SB_KEY) {
  console.error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.')
  console.error('Son las llaves viejas: si ya las quitaste de .env.local, pasalas asi:')
  console.error('  $env:SUPABASE_URL="https://xxx.supabase.co"; $env:SUPABASE_SERVICE_ROLE_KEY="ey..."; node instalacion/migrar-datos.mjs')
  process.exit(1)
}
if (!PG_URL) {
  console.error('Falta DATABASE_URL. Corre antes instalacion\\instalar-postgres.ps1')
  process.exit(1)
}

// El orden respeta las llaves foraneas: primero los catalogos, luego lo que
// los referencia. Si se invierte, Postgres rechaza los inserts.
const TABLAS = [
  'ubicaciones', 'sucursales', 'usuarios_panel', 'proveedores',
  'productos', 'clientes',
  'inventario', 'producto_codigos', 'proveedor_precios', 'proveedor_precios_historial', 'margenes',
  'conversaciones', 'mensajes',
  'solicitudes', 'solicitud_items',
  'cotizaciones', 'cotizacion_items',
  'ventas', 'venta_items', 'pagos',
  'traslados', 'traslado_items',
  'compras', 'compra_items',
  'movimientos_inventario',
  'folios',
]

// Su llave primaria, para el "on conflict". `folios` es la rara: su llave
// es compuesta y no tiene columna id.
const LLAVE = { folios: ['ambito', 'sucursal_id'] }

const cabeceras = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }

async function traer(tabla) {
  const filas = []
  const porPagina = 1000
  for (let desde = 0; ; desde += porPagina) {
    const r = await fetch(`${SB_URL}/rest/v1/${tabla}?select=*`, {
      headers: { ...cabeceras, Range: `${desde}-${desde + porPagina - 1}` },
    })
    if (r.status === 404 || r.status === 400) return null       // no existe alla
    if (!r.ok) throw new Error(`${tabla}: HTTP ${r.status} ${await r.text()}`)
    const lote = await r.json()
    filas.push(...lote)
    if (lote.length < porPagina) break
  }
  return filas
}

const cliente = new pg.Client({ connectionString: PG_URL })
await cliente.connect()

console.log(SECO ? '\n  MODO SECO: no se escribe nada\n' : '\n  Migrando datos a la base local\n')

let totalLeidas = 0, totalEscritas = 0
const problemas = []

for (const tabla of TABLAS) {
  let filas
  try {
    filas = await traer(tabla)
  } catch (e) {
    problemas.push(`${tabla}: ${e.message}`)
    console.log(`  ${tabla.padEnd(30)} ERROR al leer`)
    continue
  }

  if (filas === null) { console.log(`  ${tabla.padEnd(30)} no existe en Supabase, se salta`); continue }
  if (filas.length === 0) { console.log(`  ${tabla.padEnd(30)} 0`); continue }

  totalLeidas += filas.length
  if (SECO) { console.log(`  ${tabla.padEnd(30)} ${filas.length} (no escrito)`); continue }

  // Las columnas salen de los datos, no de un catalogo fijo: si Supabase
  // trae una columna que la base local no tiene, se avisa y se omite en vez
  // de reventar toda la migracion.
  const columnasLocales = new Set(
    (await cliente.query(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = $1`, [tabla])).rows.map(r => r.column_name)
  )
  if (columnasLocales.size === 0) {
    problemas.push(`${tabla}: no existe en la base local (falta correr las migraciones?)`)
    console.log(`  ${tabla.padEnd(30)} NO EXISTE localmente`)
    continue
  }

  const cols = Object.keys(filas[0]).filter(c => columnasLocales.has(c))
  const omitidas = Object.keys(filas[0]).filter(c => !columnasLocales.has(c))
  if (omitidas.length) problemas.push(`${tabla}: columnas que no existen localmente: ${omitidas.join(', ')}`)

  const llave = LLAVE[tabla] ?? (columnasLocales.has('id') ? ['id'] : null)
  const conflicto = llave ? `on conflict (${llave.join(', ')}) do nothing` : 'on conflict do nothing'

  let escritas = 0
  await cliente.query('begin')
  try {
    // De 200 en 200: un insert gigante de un solo golpe se topa con el
    // limite de parametros de Postgres (65535).
    for (let i = 0; i < filas.length; i += 200) {
      const lote = filas.slice(i, i + 200)
      const valores = []
      const marcadores = lote.map((fila, j) => {
        const m = cols.map((c, k) => {
          const v = fila[c]
          // jsonb y arreglos tienen que ir serializados; el resto va tal cual.
          valores.push(v !== null && typeof v === 'object' ? JSON.stringify(v) : v)
          return `$${j * cols.length + k + 1}`
        })
        return `(${m.join(', ')})`
      })
      const sql = `insert into ${tabla} (${cols.map(c => `"${c}"`).join(', ')})
                   values ${marcadores.join(', ')} ${conflicto}`
      const r = await cliente.query(sql, valores)
      escritas += r.rowCount
    }
    await cliente.query('commit')
  } catch (e) {
    await cliente.query('rollback')
    problemas.push(`${tabla}: ${e.message}`)
    console.log(`  ${tabla.padEnd(30)} ERROR: ${e.message.split('\n')[0]}`)
    continue
  }

  totalEscritas += escritas
  const nota = escritas < filas.length ? `  (${filas.length - escritas} ya estaban)` : ''
  console.log(`  ${tabla.padEnd(30)} ${escritas} de ${filas.length}${nota}`)
}

// Las secuencias no se mueven solas al insertar con id explicito: si no se
// reajustan, el siguiente insert automatico choca con un id ya usado.
if (!SECO) {
  const seqs = await cliente.query(`
    select s.relname as seq, t.relname as tabla, a.attname as col
      from pg_class s
      join pg_depend d on d.objid = s.oid and d.classid = 'pg_class'::regclass
      join pg_class t on t.oid = d.refobjid
      join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid
     where s.relkind = 'S'`)
  for (const { seq, tabla, col } of seqs.rows) {
    await cliente.query(
      `select setval($1, coalesce((select max("${col}") from "${tabla}"), 0) + 1, false)`, [seq])
  }
  if (seqs.rowCount) console.log(`\n  secuencias reajustadas: ${seqs.rowCount}`)
}

await cliente.end()

console.log(`\n  leidas: ${totalLeidas}   escritas: ${totalEscritas}`)
if (problemas.length) {
  console.log('\n  AVISOS:')
  for (const p of problemas) console.log('    - ' + p)
}
console.log('')
process.exit(problemas.some(p => p.includes('ERROR') || p.includes('no existe en la base local')) ? 1 : 0)
