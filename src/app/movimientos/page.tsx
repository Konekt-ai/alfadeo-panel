// Kardex: la libreta de entradas y salidas, pero que cuadra (minuta 10).
// Cada renglón dice qué se movió, de qué lote, cuánto había antes y después,
// por qué, en qué plaza y quién lo hizo (minuta 8, 23).

import { sql, faltaMigracion } from '@/lib/db'
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { SUCURSALES } from '@/lib/constantes'
import { formatDate, formatDia, movimientoColor, movimientoLabel } from '@/lib/utils'
import { listarUsuarios, resolverSucursal, usuarioActual } from '@/lib/usuario'
import type { Movimiento, TipoMovimiento } from '@/lib/types'
import NuevoMovimiento from './NuevoMovimiento'

export const dynamic = 'force-dynamic'

const POR_PAGINA = 100
const PAGINA_MAX = 50

const TIPOS: TipoMovimiento[] = [
  'entrada', 'salida', 'ajuste', 'venta',
  'devolucion', 'merma', 'traslado_salida', 'traslado_entrada',
]

const esTipo = (t: string | undefined): t is TipoMovimiento =>
  !!t && (TIPOS as string[]).includes(t)

// GDL y MTY están en UTC−6 todo el año (México ya no cambia de horario). El
// día se calcula con ese desfase para que "Hoy" sea el día del almacén y no
// el de UTC: si no, a partir de las 6 de la tarde el filtro se recorre.
const OFFSET_MX = '-06:00'
const diaMx = (ms: number) => new Date(ms - 6 * 3600000).toISOString().slice(0, 10)

// Existencias son numeric(14,3): se enseñan sin decimales cuando son enteras,
// que es el 99% de los casos en piezas.
const piezas = (n: number | null | undefined) => {
  const v = Number(n ?? 0)
  return Number.isInteger(v)
    ? v.toLocaleString('es-MX')
    : v.toLocaleString('es-MX', { maximumFractionDigits: 3 })
}

const chipCls = (activo: boolean) =>
  `px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors ${
    activo ? 'text-white' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
  }`

const chipEstilo = (activo: boolean) =>
  activo ? { background: '#003366', borderColor: '#003366' } : undefined

// En el celular el rótulo va arriba y los chips en una sola línea que se
// desliza, igual que en inventario.
const ROTULO = 'text-sm text-gray-500 font-medium w-full sm:w-32 shrink-0'
const FILA_CHIPS = 'flex gap-2 flex-wrap sm:items-center'
const CHIPS = 'flex gap-2 overflow-x-auto sm:flex-wrap sm:overflow-visible -mx-1 px-1 pb-1 sm:pb-0 [&>*]:shrink-0'
const CAMPO = 'w-full min-w-0 px-4 py-3 text-base border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366]'

// ---------------------------------------------------------- renglones --
// Lo mismo se pinta dos veces: como tabla en escritorio y como tarjeta en
// celular y tablet. Estas piezas son las que comparten las dos vistas.

const colorCantidad = (m: Movimiento) =>
  m.cantidad > 0
    ? 'text-emerald-600'
    : m.tipo === 'merma' ? 'text-red-600' : 'text-orange-600'

const cantidadConSigno = (m: Movimiento) =>
  `${m.cantidad > 0 ? '+' : '−'}${piezas(Math.abs(m.cantidad))}`

const detalleProducto = (m: Movimiento) =>
  [m.nombre_generico, m.concentracion, m.presentacion].filter(Boolean).join(' · ')

const chipTipo = (m: Movimiento) => (
  <span className={`inline-block text-sm font-semibold px-2.5 py-1 rounded-md whitespace-nowrap ${movimientoColor(m.tipo)}`}>
    {movimientoLabel(m.tipo)}
  </span>
)

const chipPlaza = (m: Movimiento) =>
  m.sucursal ? (
    <span className={`text-sm font-semibold px-2.5 py-1 rounded-md whitespace-nowrap ${
      m.sucursal === 'GDL' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'
    }`}>
      {m.sucursal}
    </span>
  ) : (
    <span className="text-sm text-gray-400">—</span>
  )

const existencias = (m: Movimiento) => (
  <span className="whitespace-nowrap tabular-nums">
    {piezas(m.existencia_antes)}
    <span className="mx-1.5 text-gray-300">→</span>
    <span className="text-gray-900 font-semibold">{piezas(m.existencia_despues)}</span>
  </span>
)

const quienFirmo = (m: Movimiento) =>
  m.usuario || (
    <span className="inline-flex items-center gap-1.5 text-amber-600">
      <ExclamationTriangleIcon className="w-4 h-4" />
      sin firma
    </span>
  )

export default async function MovimientosPage({
  searchParams,
}: {
  searchParams: Promise<{
    tipo?: string
    sucursal?: string
    usuario?: string
    desde?: string
    hasta?: string
    q?: string
    pagina?: string
    referencia?: string
  }>
}) {
  const params = await searchParams

  // El formulario GET manda los campos vacíos como `desde=`, así que se
  // normaliza a undefined antes de usarlos.
  const f = {
    tipo: esTipo(params.tipo) ? params.tipo : undefined,
    sucursal: params.sucursal || undefined,
    usuario: params.usuario || undefined,
    desde: params.desde || undefined,
    hasta: params.hasta || undefined,
    q: params.q || undefined,
    // Los movimientos que generó un documento concreto. Es a donde llevan los
    // enlaces "ver los movimientos de esta venta / compra / traslado".
    referencia: params.referencia || undefined,
  }

  const pagina = Math.min(Math.max(Number(params.pagina) || 1, 1), PAGINA_MAX)

  const [plazaActiva, usuariosPanel] = await Promise.all([
    resolverSucursal(),
    listarUsuarios(),
  ])
  const firma = usuarioActual()

  const { data: sucursales } = await sql<{ id: string; clave: string; nombre: string }>(
    `select id, clave, nombre
       from sucursales
      where activo
      order by es_matriz desc, clave`
  )

  // ---- Kardex ----------------------------------------------------------
  // Los filtros se arman como lista de condiciones con parámetros: nada de
  // pegar valores dentro del SQL.
  const cond: string[] = []
  const par: unknown[] = []
  const donde = (expr: string, valor: unknown) => { par.push(valor); cond.push(expr.replace('?', `$${par.length}`)) }

  if (f.tipo)     donde('tipo = ?', f.tipo)
  if (f.sucursal) donde('sucursal = ?', f.sucursal)
  if (f.usuario)  donde('usuario = ?', f.usuario)
  // El rango es por día completo y con la zona horaria explícita, para que el
  // corte del día sea el del almacén.
  if (f.desde)    donde('created_at >= ?', `${f.desde}T00:00:00${OFFSET_MX}`)
  if (f.hasta)    donde('created_at <= ?', `${f.hasta}T23:59:59.999${OFFSET_MX}`)
  // El % y el _ son comodines de LIKE: se escapan para buscarlos literales.
  if (f.q)        donde('producto ilike ?', '%' + f.q.replace(/([%_\\])/g, '\\$1') + '%')
  if (f.referencia) donde('referencia_id = ?::uuid', f.referencia)

  const where = cond.length ? `where ${cond.join(' and ')}` : ''

  // El total se calcula en la misma consulta con una ventana, para no hacer
  // dos viajes ni volver a evaluar los filtros.
  // "Cargar más" acumula: la página 2 muestra los 200 más recientes.
  const { data: filas, error } = await sql<Movimiento & { total_filas: number }>(
    `select *, count(*) over ()::int as total_filas
       from v_movimientos
       ${where}
      order by created_at desc, id desc
      limit ${pagina * POR_PAGINA}`,
    par
  )

  const movimientos = filas as Movimiento[]
  const total = filas[0]?.total_filas ?? movimientos.length
  const hayMas = movimientos.length < total

  const entraron = movimientos.reduce((s, m) => s + (m.cantidad > 0 ? m.cantidad : 0), 0)
  const salieron = movimientos.reduce((s, m) => s + (m.cantidad < 0 ? -m.cantidad : 0), 0)

  // ---- Filtros ---------------------------------------------------------
  const hoy = diaMx(Date.now())
  const haceDias = (n: number) => diaMx(Date.now() - n * 86400000)

  const buildUrl = (cambios: Record<string, string | undefined>) => {
    // Al cambiar cualquier filtro se vuelve a la primera página.
    const p: Record<string, string | undefined> = { ...f, ...cambios }
    const qs = Object.entries(p)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
      .join('&')
    return `/movimientos${qs ? `?${qs}` : ''}`
  }

  const rangos = [
    { label: 'Todo', desde: undefined, hasta: undefined },
    { label: 'Hoy', desde: hoy, hasta: hoy },
    { label: 'Últimos 7 días', desde: haceDias(6), hasta: undefined },
    { label: 'Últimos 30 días', desde: haceDias(29), hasta: undefined },
  ]

  // El filtro por persona sale de usuarios_panel; si en la URL viene alguien
  // que ya no está activo, se conserva su chip para poder quitarlo.
  const nombresUsuario = usuariosPanel.map(u => u.nombre)
  if (f.usuario && !nombresUsuario.includes(f.usuario)) {
    nombresUsuario.push(f.usuario)
  }

  const hayFiltros = Boolean(f.tipo || f.sucursal || f.usuario || f.desde || f.hasta || f.q || f.referencia)

  const sinResultados = hayFiltros
    ? 'Ningún movimiento con estos filtros.'
    : 'Todavía no hay movimientos registrados.'

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {f.referencia && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 sm:px-5 py-4 mb-6 flex flex-wrap items-center gap-3">
          <span className="text-base text-blue-900 min-w-0 break-words">
            Mostrando sólo los movimientos de un documento
            {movimientos[0]?.motivo && <> · <strong>{movimientos[0].motivo}</strong></>}.
          </span>
          <a href={buildUrl({ referencia: undefined })}
            className="ml-auto text-base font-medium text-[#003366] hover:underline whitespace-nowrap">
            Ver todos
          </a>
        </div>
      )}

      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Movimientos de inventario</h1>
        <p className="text-base text-gray-500 mt-1">
          {total.toLocaleString('es-MX')} movimientos
          {movimientos.length < total && ` · mostrando ${movimientos.length.toLocaleString('es-MX')}`}
          {movimientos.length > 0 && (
            <>
              {' · '}
              <span className="text-emerald-600 font-medium">+{piezas(entraron)}</span>
              {' / '}
              <span className="text-orange-600 font-medium">−{piezas(salieron)}</span>
              {' pza'}
            </>
          )}
        </p>
      </div>

      {/* Alta rápida: entrada, salida o ajuste */}
      <NuevoMovimiento
        usuario={firma}
        usuarios={usuariosPanel}
        sucursales={sucursales}
        sucursalInicial={plazaActiva?.id ?? sucursales[0]?.id ?? ''}
      />

      {/* Buscador + filtros */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5 mb-6 space-y-4">
        <form method="GET" className="flex flex-col md:flex-row gap-3">
          {f.tipo && <input type="hidden" name="tipo" value={f.tipo} />}
          {f.sucursal && <input type="hidden" name="sucursal" value={f.sucursal} />}
          {f.usuario && <input type="hidden" name="usuario" value={f.usuario} />}
          <input
            name="q"
            defaultValue={f.q}
            placeholder="Buscar por producto..."
            className={`${CAMPO} md:flex-1 md:self-end`}
          />
          {/* En el celular las dos fechas van lado a lado y el botón abajo a
              todo lo ancho: en una sola fila no cabían. */}
          <div className="grid grid-cols-2 gap-3 sm:flex">
            <div className="min-w-0 sm:flex-1">
              <label className="block text-xs font-medium text-gray-400 mb-1">Desde</label>
              <input
                type="date"
                name="desde"
                defaultValue={f.desde}
                className={CAMPO}
              />
            </div>
            <div className="min-w-0 sm:flex-1">
              <label className="block text-xs font-medium text-gray-400 mb-1">Hasta</label>
              <input
                type="date"
                name="hasta"
                defaultValue={f.hasta}
                className={CAMPO}
              />
            </div>
            <button
              type="submit"
              className="col-span-2 sm:self-end px-5 py-3 bg-[#003366] text-white text-base font-medium rounded-lg hover:bg-[#002244] transition-colors whitespace-nowrap"
            >
              Filtrar
            </button>
          </div>
        </form>

        <div className={FILA_CHIPS}>
          <span className={ROTULO}>Periodo</span>
          <div className={CHIPS}>
            {rangos.map(r => {
              const activo = f.desde === r.desde && f.hasta === r.hasta
              return (
                <a
                  key={r.label}
                  href={buildUrl({ desde: r.desde, hasta: r.hasta })}
                  className={chipCls(activo)}
                  style={chipEstilo(activo)}
                >
                  {r.label}
                </a>
              )
            })}
          </div>
        </div>

        <div className={FILA_CHIPS}>
          <span className={ROTULO}>Tipo</span>
          <div className={CHIPS}>
            {TIPOS.map(t => {
              const activo = f.tipo === t
              return (
                <a
                  key={t}
                  href={buildUrl({ tipo: activo ? undefined : t })}
                  className={chipCls(activo)}
                  style={chipEstilo(activo)}
                >
                  {movimientoLabel(t)}
                </a>
              )
            })}
          </div>
        </div>

        <div className={FILA_CHIPS}>
          <span className={ROTULO}>Plaza</span>
          <div className={CHIPS}>
            {SUCURSALES.map(s => {
              const activo = f.sucursal === s.clave
              return (
                <a
                  key={s.clave}
                  href={buildUrl({ sucursal: activo ? undefined : s.clave })}
                  className={chipCls(activo)}
                  style={chipEstilo(activo)}
                >
                  {s.nombre}
                </a>
              )
            })}
          </div>
        </div>

        {nombresUsuario.length > 0 && (
          <div className={FILA_CHIPS}>
            <span className={ROTULO}>Quién</span>
            <div className={CHIPS}>
              {nombresUsuario.map(n => {
                const activo = f.usuario === n
                return (
                  <a
                    key={n}
                    href={buildUrl({ usuario: activo ? undefined : n })}
                    className={chipCls(activo)}
                    style={chipEstilo(activo)}
                  >
                    {n}
                  </a>
                )
              })}
            </div>
          </div>
        )}

        {hayFiltros && (
          <div>
            <a href="/movimientos" className="text-sm font-medium text-[#003366] hover:underline">
              Quitar todos los filtros
            </a>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-6 text-base break-words">
          {error.message}
          {faltaMigracion(error.message) && (
            <p className="mt-2 text-sm">
              Falta preparar la base. En esa computadora corre{' '}
              <code className="font-mono">instalacion\instalar-base.ps1</code>.
            </p>
          )}
        </div>
      )}

      {/* Escritorio: tabla. */}
      <div className="hidden lg:block bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-base min-w-[1240px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Fecha</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Tipo</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Producto</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Lote</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Cantidad</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Existencia</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Motivo</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Plaza</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Quién</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {movimientos.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-20 text-gray-400 text-base">
                    {sinResultados}
                  </td>
                </tr>
              )}
              {movimientos.map(m => {
                const detalle = detalleProducto(m)
                return (
                  <tr key={m.id} className="hover:bg-gray-50/60 transition-colors">
                    <td className="px-5 py-4 whitespace-nowrap text-sm text-gray-600">
                      {formatDate(m.created_at)}
                    </td>
                    <td className="px-5 py-4">{chipTipo(m)}</td>
                    {/* Comercial arriba, genérico abajo: así lo busca el equipo. */}
                    <td className="px-5 py-4 min-w-[240px]">
                      <div className="font-semibold text-gray-900">{m.producto}</div>
                      {detalle && <div className="text-sm text-gray-500 mt-0.5">{detalle}</div>}
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      <div className="font-mono text-sm text-gray-600">{m.lote || '—'}</div>
                      {m.caducidad && (
                        <div className="text-sm text-gray-400 mt-0.5">cad. {formatDia(m.caducidad)}</div>
                      )}
                    </td>
                    <td className={`px-5 py-4 whitespace-nowrap text-lg font-semibold tabular-nums ${colorCantidad(m)}`}>
                      {cantidadConSigno(m)}
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-500">{existencias(m)}</td>
                    <td className="px-5 py-4 text-sm text-gray-600 min-w-[180px]">
                      {m.motivo || '—'}
                      {m.referencia_tipo && m.referencia_tipo !== 'manual' && (
                        <div className="text-sm text-gray-400 mt-0.5">ref. {m.referencia_tipo}</div>
                      )}
                    </td>
                    <td className="px-5 py-4">{chipPlaza(m)}</td>
                    <td className="px-5 py-4 text-sm text-gray-600 whitespace-nowrap">{quienFirmo(m)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Celular y tablet: una tarjeta por movimiento, con la cantidad arriba
          a la derecha, que es lo primero que se busca. */}
      <div className="lg:hidden">
        {movimientos.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-xl text-center py-16 text-gray-400 text-base">
            {sinResultados}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {movimientos.map(m => {
            const detalle = detalleProducto(m)
            return (
              <div key={m.id} className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-900 break-words">{m.producto}</div>
                    {detalle && <div className="text-sm text-gray-500 mt-0.5">{detalle}</div>}
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`text-2xl font-semibold leading-none tabular-nums ${colorCantidad(m)}`}>
                      {cantidadConSigno(m)}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">piezas</div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {chipTipo(m)}
                  {m.sucursal && chipPlaza(m)}
                  <span className="text-sm text-gray-500">
                    Existencia {existencias(m)}
                  </span>
                </div>

                <div className="mt-3 pt-3 border-t border-gray-100 space-y-1 text-sm text-gray-500">
                  <div className="flex flex-wrap gap-x-2">
                    <span className="font-mono text-gray-600 break-all">{m.lote || 'sin lote'}</span>
                    {m.caducidad && <span>· cad. {formatDia(m.caducidad)}</span>}
                  </div>
                  <div className="text-gray-600 break-words">
                    {m.motivo || '—'}
                    {m.referencia_tipo && m.referencia_tipo !== 'manual' && (
                      <span className="text-gray-400"> · ref. {m.referencia_tipo}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-2">
                    <span>{formatDate(m.created_at)}</span>
                    <span>·</span>
                    <span>{quienFirmo(m)}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* "Cargar más" va fuera de las dos vistas para que sirva en ambas. */}
      {hayMas && (
        <div id="fin" className="mt-6 text-center">
          <a
            href={`${buildUrl({ pagina: String(pagina + 1) })}#fin`}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-white border border-gray-200 text-base font-medium text-[#003366] rounded-lg hover:border-[#003366] transition-colors"
          >
            Cargar más
          </a>
          <p className="text-sm text-gray-400 mt-2">
            Mostrando {movimientos.length.toLocaleString('es-MX')} de {total.toLocaleString('es-MX')}
          </p>
        </div>
      )}
    </div>
  )
}
