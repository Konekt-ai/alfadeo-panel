import { supabase } from '@/lib/supabase'
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
  traslado_items: { id: string; cantidad: number }[]
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

  let consulta = supabase
    .from('traslados')
    .select(`
      id, folio, origen_id, destino_id, estado, paqueteria, guia,
      fecha_envio, fecha_estimada, fecha_recepcion, usuario, created_at,
      traslado_items ( id, cantidad )
    `)
    .order('created_at', { ascending: false })
    .limit(200)

  if (params.estado) consulta = consulta.eq('estado', params.estado)

  // Las plazas se traen aparte: `traslados` apunta dos veces a
  // `sucursales` (origen y destino) y un embed sin desambiguar es
  // frágil. Son dos filas, sale más barato resolverlo en memoria.
  const [{ data, error }, { data: datosPlazas }] = await Promise.all([
    consulta,
    supabase.from('sucursales').select('id, clave, nombre').order('clave'),
  ])

  // PostgREST no tipa los embeds sin tipos generados; se afirma la forma
  // que pide el `select` de arriba.
  const filas = (data ?? []) as unknown as FilaTraslado[]
  const plazas = (datosPlazas ?? []) as unknown as Plaza[]

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

  return (
    <div className="p-8">
      <div className="flex items-center justify-between gap-4 mb-8 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Traslados entre plazas</h1>
          <p className="text-base text-gray-500 mt-1">
            {rows.length} traslado{rows.length === 1 ? '' : 's'}
            {enTransito > 0 && ` · ${enTransito} en tránsito`}
          </p>
        </div>
        <Link
          href="/traslados/nuevo"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#003366] text-white text-base font-medium rounded-lg hover:bg-[#002244] transition-colors"
        >
          <PlusIcon className="w-5 h-5" />
          Nuevo traslado
        </Link>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6 space-y-4">
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-sm text-gray-500 mr-1 font-medium">Estado:</span>
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

        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-sm text-gray-500 mr-1 font-medium">Plaza:</span>
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
          <span className="text-sm text-gray-400 ml-1">envía o recibe</span>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-6 text-base">
          {error.message}
          {/relation|column|function/i.test(error.message) && (
            <p className="mt-2 text-sm">
              Falta correr <code className="font-mono">supabase/reunion-operacion.sql</code> en el SQL Editor de Supabase.
            </p>
          )}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
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
                    Sin traslados todavía.
                  </td>
                </tr>
              )}
              {rows.map(r => {
                const partidas = r.traslado_items ?? []
                const piezas = partidas.reduce((s, i) => s + Number(i.cantidad ?? 0), 0)
                return (
                  <tr key={r.id} className="hover:bg-gray-50/60 transition-colors group">
                    <td className="px-5 py-4">
                      <Link href={`/traslados/${r.id}`} className="font-semibold text-gray-900 font-mono hover:text-[#003366]">
                        {r.folio ?? 'Sin folio'}
                      </Link>
                      <div className="text-sm text-gray-400 mt-0.5">{formatDia(r.created_at)}</div>
                    </td>

                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <span className="text-sm font-semibold px-2.5 py-1 rounded-md bg-blue-50 text-blue-700">
                          {clave(r.origen_id)}
                        </span>
                        <ArrowRightIcon className="w-4 h-4 text-gray-300" />
                        <span className="text-sm font-semibold px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700">
                          {clave(r.destino_id)}
                        </span>
                      </div>
                      <div className="text-sm text-gray-400 mt-1">
                        {nombrePlaza(r.origen_id)} → {nombrePlaza(r.destino_id)}
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      <span className={`inline-block text-sm font-semibold px-2.5 py-1 rounded-md whitespace-nowrap ${trasladoColor(r.estado)}`}>
                        {trasladoLabel(r.estado)}
                      </span>
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
                      <span className="text-lg font-semibold text-gray-900">{partidas.length}</span>
                      <span className="text-sm text-gray-400 ml-1.5">
                        {partidas.length === 1 ? 'partida' : 'partidas'} · {piezas.toLocaleString('es-MX')} pz
                      </span>
                    </td>

                    <td className="px-5 py-4 text-gray-500">{r.usuario ?? '—'}</td>

                    <td className="px-5 py-4">
                      <Link
                        href={`/traslados/${r.id}`}
                        className="text-sm font-medium text-[#003366] md:opacity-0 md:group-hover:opacity-100 transition-opacity hover:underline whitespace-nowrap"
                      >
                        {r.estado === 'en_transito' ? 'Recibir' : 'Ver'}
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
