import { supabase } from '@/lib/supabase'
import type { Solicitud, EstadoSolicitud } from '@/lib/types'
import { estadoLabel, estadoColor, urgenciaColor, canalLabel, formatDate } from '@/lib/utils'
import Link from 'next/link'
import { ExclamationTriangleIcon, ChevronRightIcon } from '@heroicons/react/20/solid'
import { FunnelIcon } from '@heroicons/react/24/outline'

const ESTADOS: EstadoSolicitud[] = [
  'nueva', 'en_revision', 'cotizada', 'enviada',
  'aceptada', 'rechazada', 'facturada', 'cancelada',
]

export const dynamic = 'force-dynamic'

export default async function SolicitudesPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; canal?: string; humano?: string }>
}) {
  const params = await searchParams
  let query = supabase
    .from('solicitudes')
    .select(`
      id, folio, canal, estado, urgencia, ciudad_entrega,
      requiere_humano, notas, created_at, updated_at,
      clientes ( id, nombre, empresa, tipo, ciudad, telefono_wa, correo )
    `)
    .order('created_at', { ascending: false })

  if (params.estado) query = query.eq('estado', params.estado)
  if (params.canal) query = query.eq('canal', params.canal)
  if (params.humano === '1') query = query.eq('requiere_humano', true)

  const { data: solicitudes, error } = await query

  const buildUrl = (overrides: Record<string, string | undefined>) => {
    const p = { estado: params.estado, canal: params.canal, humano: params.humano, ...overrides }
    const qs = Object.entries(p).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('&')
    return `/solicitudes${qs ? `?${qs}` : ''}`
  }

  return (
    <div className="p-4 md:p-8">
      <div className="flex items-center justify-between mb-6 md:mb-8">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Solicitudes</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {solicitudes?.length ?? 0} {(solicitudes?.length ?? 0) === 1 ? 'registro' : 'registros'}
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 md:px-5 md:py-4 mb-5 space-y-3">
        <div className="flex items-center gap-1.5 text-gray-400">
          <FunnelIcon className="w-3.5 h-3.5" />
          <span className="text-xs font-semibold uppercase tracking-wider">Filtros</span>
        </div>
        <div className="space-y-3 md:flex md:space-y-0 md:flex-wrap md:gap-y-3 md:gap-x-6">
          <FilterGroup label="Estado">
            <Chip href="/solicitudes" active={!params.estado}>Todos</Chip>
            {ESTADOS.map(e => (
              <Chip key={e} href={buildUrl({ estado: e })} active={params.estado === e}>
                {estadoLabel(e)}
              </Chip>
            ))}
          </FilterGroup>
          <div className="hidden md:block w-px bg-gray-100 self-stretch" />
          <FilterGroup label="Canal">
            <Chip href={buildUrl({ canal: undefined })} active={!params.canal}>Todos</Chip>
            <Chip href={buildUrl({ canal: 'whatsapp' })} active={params.canal === 'whatsapp'}>WhatsApp</Chip>
            <Chip href={buildUrl({ canal: 'web' })} active={params.canal === 'web'}>Web</Chip>
          </FilterGroup>
          <div className="hidden md:block w-px bg-gray-100 self-stretch" />
          <FilterGroup label="Atención">
            <Chip href={buildUrl({ humano: params.humano === '1' ? undefined : '1' })} active={params.humano === '1'}>
              Requiere humano
            </Chip>
          </FilterGroup>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-5 text-sm">
          Error al cargar: {error.message}
        </div>
      )}

      {/* Tabla — desktop */}
      <div className="hidden md:block bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Folio</th>
              <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Cliente</th>
              <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Canal</th>
              <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Estado</th>
              <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Urgencia</th>
              <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Ciudad entrega</th>
              <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Fecha</th>
              <th className="px-5 py-3.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {(!solicitudes || solicitudes.length === 0) && (
              <tr>
                <td colSpan={8} className="text-center py-20 text-gray-300 text-sm">
                  No hay solicitudes con los filtros seleccionados.
                </td>
              </tr>
            )}
            {solicitudes?.map((s) => {
              const sol = s as unknown as Solicitud
              return (
                <tr key={sol.id} className="hover:bg-gray-50/60 transition-colors group">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-[#003366]">#{sol.folio}</span>
                      {sol.requiere_humano && (
                        <ExclamationTriangleIcon className="w-3.5 h-3.5 text-amber-500 shrink-0" title="Requiere atención humana" />
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <div className="font-medium text-gray-900">{sol.clientes?.nombre ?? '—'}</div>
                    {sol.clientes?.empresa && (
                      <div className="text-xs text-gray-400 mt-0.5">{sol.clientes.empresa}</div>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded-md">
                      {canalLabel(sol.canal)}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${estadoColor(sol.estado)}`}>
                      {estadoLabel(sol.estado)}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${urgenciaColor(sol.urgencia)}`}>
                      {sol.urgencia}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-gray-500 text-sm">{sol.ciudad_entrega ?? '—'}</td>
                  <td className="px-5 py-4 text-gray-400 text-xs whitespace-nowrap">{formatDate(sol.created_at)}</td>
                  <td className="px-5 py-4">
                    <Link href={`/solicitudes/${sol.id}`}>
                      <ChevronRightIcon className="w-4 h-4 text-gray-300 group-hover:text-[#003366] transition-colors" />
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Tarjetas — móvil */}
      <div className="md:hidden space-y-3">
        {(!solicitudes || solicitudes.length === 0) && (
          <div className="text-center py-16 text-gray-300 text-sm bg-white border border-gray-200 rounded-xl">
            No hay solicitudes con los filtros seleccionados.
          </div>
        )}
        {solicitudes?.map((s) => {
          const sol = s as unknown as Solicitud
          return (
            <Link
              key={sol.id}
              href={`/solicitudes/${sol.id}`}
              className="block bg-white border border-gray-200 rounded-xl p-4 active:bg-gray-50"
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold text-[#003366]">#{sol.folio}</span>
                  {sol.requiere_humano && (
                    <ExclamationTriangleIcon className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${estadoColor(sol.estado)}`}>
                    {estadoLabel(sol.estado)}
                  </span>
                  <ChevronRightIcon className="w-4 h-4 text-gray-300" />
                </div>
              </div>
              <div className="font-medium text-gray-900 text-sm">{sol.clientes?.nombre ?? '—'}</div>
              {sol.clientes?.empresa && (
                <div className="text-xs text-gray-400 mt-0.5">{sol.clientes.empresa}</div>
              )}
              <div className="flex items-center gap-3 mt-3 flex-wrap">
                <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-md">
                  {canalLabel(sol.canal)}
                </span>
                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${urgenciaColor(sol.urgencia)}`}>
                  {sol.urgencia}
                </span>
                {sol.ciudad_entrega && (
                  <span className="text-xs text-gray-400">{sol.ciudad_entrega}</span>
                )}
                <span className="text-xs text-gray-300 ml-auto">{formatDate(sol.created_at)}</span>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-xs text-gray-400 mr-1">{label}:</span>
      {children}
    </div>
  )
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
        active
          ? 'bg-[#003366] text-white border-[#003366]'
          : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300 hover:text-gray-700'
      }`}
    >
      {children}
    </a>
  )
}
