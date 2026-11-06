import { sql, faltaMigracion } from '@/lib/db'
import Link from 'next/link'
import { PlusIcon, ArrowRightIcon } from '@heroicons/react/20/solid'
import { SUCURSALES } from '@/lib/constantes'
import { formatDia } from '@/lib/utils'
import type { EstadoTraslado } from '@/lib/types'

export const dynamic = 'force-dynamic'

// Traslados entre plazas (minuta 9 y 37): GDL y MTY son empresas
// independientes del mismo dueño y Monterrey se surte de Guadalajara.
// Aquí se ve, de un vistazo, qué salió, qué va en camino y qué falta
// recibir.

interface FilaTraslado {
  id: string
  folio: string | null
  origen_id: string
  destino_id: string
  estado: EstadoTraslado
  paqueteria: string | null
  guia: string | null
  fecha_envio: string | null
  fecha_estimada: string | null
  fecha_recepcion: string | null
  usuario: string | null
  created_at: string
  num_partidas: number
  total_piezas: number
}

interface Plaza {
  id: string
  clave: string | null
  nombre: string | null
}

const ESTADOS: { valor: EstadoTraslado; label: string }[] = [
  { valor: 'borrador', label: 'Borrador' },
  { valor: 'en_transito', label: 'En tránsito' },
  { valor: 'recibido', label: 'Recibido' },
  { valor: 'cancelado', label: 'Cancelado' },
]

function trasladoLabel(e: EstadoTraslado) {
  return ESTADOS.find(x => x.valor === e)?.label ?? e
}

function trasladoColor(e: EstadoTraslado) {
  const map: Record<EstadoTraslado, string> = {
    borrador: 'bg-gray-100 text-gray-700',
    en_transito: 'bg-amber-100 text-amber-800',
    recibido: 'bg-emerald-100 text-emerald-800',
    cancelado: 'bg-gray-100 text-gray-400',
  }
  return map[e] ?? 'bg-gray-100 text-gray-700'
}

export default async function TrasladosPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; plaza?: string }>
}) {
  const params = await searchParams

  // Las partidas sólo se usan para contar renglones y sumar piezas: se
  // resuelve con agregados en vez de traerlas todas.
  const cond: string[] = []
  const par: unknown[] = []
  if (params.estado) { par.push(params.estado); cond.push(`t.estado = $${par.length}`) }
  const where = cond.length ? `where ${cond.join(' and ')}` : ''

  const consulta = sql<FilaTraslado>(
    `select t.id, t.folio, t.origen_id, t.destino_id, t.estado, t.paqueteria,
            t.guia, t.fecha_envio, t.fecha_estimada, t.fecha_recepcion,
            t.usuario, t.created_at,
            (select count(*) from traslado_items ti where ti.traslado_id = t.id)::int
              as num_partidas,
            coalesce((select sum(ti.cantidad) from traslado_items ti
                       where ti.traslado_id = t.id), 0) as total_piezas
       from traslados t
       ${where}
      order by t.created_at desc
      limit 200`,
    par
  )

  // Las plazas se traen aparte: `traslados` apunta dos veces a
  // `sucursales` (origen y destino) y un embed sin desambiguar es
  // frágil. Son dos filas, sale más barato resolverlo en memoria.
  const [{ data, error }, { data: datosPlazas }] = await Promise.all([
    consulta,
    sql<Plaza>(`select id, clave, nombre from sucursales order by clave`),
  ])

  const filas = data
  const plazas = datosPlazas

  const porId = new Map(plazas.map(p => [p.id, p]))
  const clave = (id: string) => porId.get(id)?.clave ?? '—'
  const nombrePlaza = (id: string) => porId.get(id)?.nombre ?? '—'

  const rows = filas.filter(r => {
    // La plaza filtra por los dos extremos: lo que salió y lo que llega.
    if (params.plaza && clave(r.origen_id) !== params.plaza && clave(r.destino_id) !== params.plaza) {
      return false
    }
    return true
  })

  const enTransito = rows.filter(r => r.estado === 'en_transito').length

  const buildUrl = (o: Record<string, string | undefined>) => {
    const p = { estado: params.estado, plaza: params.plaza, ...o }
    const qs = Object.entries(p)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
      .join('&')
    return `/traslados${qs ? `?${qs}` : ''}`
  }

  const chip = (activo: boolean) =>
    `px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors ${
      activo ? 'text-white' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
    }`

  // En el celular el rótulo va arriba y los chips en una sola línea que se
  // desliza, igual que en inventario.
  const ROTULO = 'text-sm text-gray-500 font-medium w-full sm:w-32 shrink-0'
  const FILA_CHIPS = 'flex gap-2 flex-wrap sm:items-center'
  const CHIPS = 'flex gap-2 overflow-x-auto sm:flex-wrap sm:overflow-visible -mx-1 px-1 pb-1 sm:pb-0 [&>*]:shrink-0'

  // ---- Piezas que comparten la tabla y las tarjetas ---------------------
  const datosFila = (r: FilaTraslado) => {
    // La consulta ya trae el conteo y la suma; antes se leía `traslado_items`,
    // que dejó de venir al quitar Supabase, y siempre salía 0.
    const partidas = Number(r.num_partidas ?? 0)
    const piezas = Number(r.total_piezas ?? 0)
    return {
      partidas,
      piezas,
      resumenPartidas: `${partidas === 1 ? 'partida' : 'partidas'} · ${piezas.toLocaleString('es-MX')} pz`,
      accion: r.estado === 'en_transito' ? 'Recibir' : 'Ver',
    }
  }

  const ruta = (r: FilaTraslado) => (
    <div className="flex items-center gap-2 whitespace-nowrap">
      <span className="text-sm font-semibold px-2.5 py-1 rounded-md bg-blue-50 text-blue-700">
        {clave(r.origen_id)}
      </span>
      <ArrowRightIcon className="w-4 h-4 text-gray-300" />
      <span className="text-sm font-semibold px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700">
        {clave(r.destino_id)}
      </span>
    </div>
  )

  const chipEstado = (r: FilaTraslado) => (
    <span className={`inline-block text-sm font-semibold px-2.5 py-1 rounded-md whitespace-nowrap ${trasladoColor(r.estado)}`}>
      {trasladoLabel(r.estado)}
    </span>
  )

  const sinTraslados = 'Sin traslados todavía.'

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6 sm:mb-8">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-gray-900">Traslados entre plazas</h1>
          <p className="text-base text-gray-500 mt-1">
            {rows.length} traslado{rows.length === 1 ? '' : 's'}
            {enTransito > 0 && ` · ${enTransito} en tránsito`}
          </p>
        </div>
        <Link
          href="/traslados/nuevo"
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#003366] text-white text-base font-medium rounded-lg hover:bg-[#002244] transition-colors"
        >
          <PlusIcon className="w-5 h-5" />
          Nuevo traslado
        </Link>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5 mb-6 space-y-4">
        <div className={FILA_CHIPS}>
          <span className={ROTULO}>Estado</span>
          <div className={CHIPS}>
            {ESTADOS.map(e => (
              <a
                key={e.valor}
                href={buildUrl({ estado: params.estado === e.valor ? undefined : e.valor })}
                className={chip(params.estado === e.valor)}
                style={params.estado === e.valor ? { background: '#003366', borderColor: '#003366' } : undefined}
              >
                {e.label}
              </a>
            ))}
          </div>
        </div>

        <div className={FILA_CHIPS}>
          <span className={ROTULO}>Plaza</span>
          <div className={CHIPS}>
            {SUCURSALES.map(s => (
              <a
                key={s.clave}
                href={buildUrl({ plaza: params.plaza === s.clave ? undefined : s.clave })}
                className={chip(params.plaza === s.clave)}
                style={params.plaza === s.clave ? { background: '#003366', borderColor: '#003366' } : undefined}
              >
                {s.nombre}
              </a>
            ))}
            <span className="self-center text-sm text-gray-400 ml-1">envía o recibe</span>
          </div>
        </div>
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
          <table className="w-full text-base min-w-[1100px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Folio</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Ruta</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Estado</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Paquetería y guía</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Enviado</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Llegada estimada</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Partidas</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Lo hizo</th>
                <th className="px-5 py-4" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-20 text-gray-400 text-base">
                    {sinTraslados}
                  </td>
                </tr>
              )}
              {rows.map(r => {
                const { partidas, resumenPartidas, accion } = datosFila(r)
                return (
                  <tr key={r.id} className="hover:bg-gray-50/60 transition-colors group">
                    <td className="px-5 py-4">
                      <Link href={`/traslados/${r.id}`} className="font-semibold text-gray-900 font-mono hover:text-[#003366]">
                        {r.folio ?? 'Sin folio'}
                      </Link>
                      <div className="text-sm text-gray-400 mt-0.5">{formatDia(r.created_at)}</div>
                    </td>

                    <td className="px-5 py-4">
                      {ruta(r)}
                      <div className="text-sm text-gray-400 mt-1">
                        {nombrePlaza(r.origen_id)} → {nombrePlaza(r.destino_id)}
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      {chipEstado(r)}
                      {r.estado === 'recibido' && r.fecha_recepcion && (
                        <div className="text-sm text-gray-400 mt-1">{formatDia(r.fecha_recepcion)}</div>
                      )}
                    </td>

                    <td className="px-5 py-4">
                      <div className="text-gray-700">{r.paqueteria ?? '—'}</div>
                      <div className="font-mono text-sm text-gray-500 mt-0.5">{r.guia ?? 'sin guía'}</div>
                    </td>

                    <td className="px-5 py-4 text-gray-600 whitespace-nowrap">
                      {r.fecha_envio ? formatDia(r.fecha_envio) : '—'}
                    </td>

                    <td className="px-5 py-4 text-gray-600 whitespace-nowrap">
                      {formatDia(r.fecha_estimada)}
                    </td>

                    <td className="px-5 py-4 whitespace-nowrap">
                      <span className="text-lg font-semibold text-gray-900">{partidas}</span>
                      <span className="text-sm text-gray-400 ml-1.5">{resumenPartidas}</span>
                    </td>

                    <td className="px-5 py-4 text-gray-500">{r.usuario ?? '—'}</td>

                    <td className="px-5 py-4">
                      <Link
                        href={`/traslados/${r.id}`}
                        className="text-sm font-medium text-[#003366] md:opacity-0 md:group-hover:opacity-100 transition-opacity hover:underline whitespace-nowrap"
                      >
                        {accion}
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Celular y tablet: una tarjeta por traslado; toda la tarjeta abre el
          detalle. */}
      <div className="lg:hidden">
        {rows.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-xl text-center py-16 text-gray-400 text-base">
            {sinTraslados}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {rows.map(r => {
            const { partidas, resumenPartidas, accion } = datosFila(r)
            return (
              <Link
                key={r.id}
                href={`/traslados/${r.id}`}
                className="block bg-white border border-gray-200 rounded-xl p-4 hover:border-gray-300 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-900 font-mono break-all">{r.folio ?? 'Sin folio'}</div>
                    <div className="text-sm text-gray-400 mt-0.5">{formatDia(r.created_at)}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    {chipEstado(r)}
                    {r.estado === 'recibido' && r.fecha_recepcion && (
                      <div className="text-sm text-gray-400 mt-1">{formatDia(r.fecha_recepcion)}</div>
                    )}
                  </div>
                </div>

                <div className="mt-3">
                  {ruta(r)}
                  <div className="text-sm text-gray-400 mt-1 break-words">
                    {nombrePlaza(r.origen_id)} → {nombrePlaza(r.destino_id)}
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-gray-100 space-y-1 text-sm text-gray-500">
                  <div className="break-words">
                    <span className="text-gray-700">{r.paqueteria ?? 'Sin paquetería'}</span>
                    {' · '}
                    <span className="font-mono break-all">{r.guia ?? 'sin guía'}</span>
                  </div>
                  <div>
                    Enviado {r.fecha_envio ? formatDia(r.fecha_envio) : '—'}
                    {' · '}llega {formatDia(r.fecha_estimada)}
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>
                      <span className="font-semibold text-gray-900">{partidas}</span> {resumenPartidas}
                      {r.usuario && <> · {r.usuario}</>}
                    </span>
                    <span className="shrink-0 font-medium text-[#003366]">{accion} →</span>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
