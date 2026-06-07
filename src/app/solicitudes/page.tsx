import { supabase } from '@/lib/supabase'
import type { Solicitud, EstadoSolicitud } from '@/lib/types'
import { estadoLabel, estadoColor, urgenciaColor, canalLabel, formatDate } from '@/lib/utils'
import Link from 'next/link'

const ESTADOS: EstadoSolicitud[] = ['nueva', 'en_revision', 'cotizada', 'enviada', 'aceptada', 'rechazada', 'facturada', 'cancelada']

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

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Solicitudes</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {solicitudes?.length ?? 0} solicitudes encontradas
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-5 flex flex-wrap gap-3">
        <FilterGroup label="Estado">
          <FilterLink href="/solicitudes" active={!params.estado} label="Todas" />
          {ESTADOS.map(e => (
            <FilterLink
              key={e}
              href={`/solicitudes?estado=${e}${params.canal ? `&canal=${params.canal}` : ''}${params.humano ? `&humano=${params.humano}` : ''}`}
              active={params.estado === e}
              label={estadoLabel(e)}
            />
          ))}
        </FilterGroup>

        <div className="w-px bg-gray-200 self-stretch" />

        <FilterGroup label="Canal">
          <FilterLink href={`/solicitudes${params.estado ? `?estado=${params.estado}` : ''}`} active={!params.canal} label="Todos" />
          <FilterLink href={`/solicitudes?canal=whatsapp${params.estado ? `&estado=${params.estado}` : ''}`} active={params.canal === 'whatsapp'} label="WhatsApp" />
          <FilterLink href={`/solicitudes?canal=web${params.estado ? `&estado=${params.estado}` : ''}`} active={params.canal === 'web'} label="Web" />
        </FilterGroup>

        <div className="w-px bg-gray-200 self-stretch" />

        <FilterGroup label="Atención">
          <FilterLink
            href={`/solicitudes?humano=1${params.estado ? `&estado=${params.estado}` : ''}${params.canal ? `&canal=${params.canal}` : ''}`}
            active={params.humano === '1'}
            label="🚨 Requiere humano"
          />
        </FilterGroup>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-5 text-sm">
          Error al cargar: {error.message}
        </div>
      )}

      {/* Tabla */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-3 font-medium text-gray-600">Folio</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Cliente</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Canal</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Estado</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Urgencia</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Ciudad entrega</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Fecha</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(!solicitudes || solicitudes.length === 0) && (
              <tr>
                <td colSpan={8} className="text-center py-16 text-gray-400">
                  No hay solicitudes con estos filtros.
                </td>
              </tr>
            )}
            {solicitudes?.map((s) => {
              const sol = s as unknown as Solicitud
              return (
                <tr key={sol.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-mono font-medium text-[#003366]">
                    #{sol.folio}
                    {sol.requiere_humano && <span className="ml-1.5 text-red-500" title="Requiere atención humana">🚨</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{sol.clientes?.nombre ?? '—'}</div>
                    <div className="text-gray-500 text-xs">{sol.clientes?.empresa ?? ''}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{canalLabel(sol.canal)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${estadoColor(sol.estado)}`}>
                      {estadoLabel(sol.estado)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${urgenciaColor(sol.urgencia)}`}>
                      {sol.urgencia}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{sol.ciudad_entrega ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{formatDate(sol.created_at)}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/solicitudes/${sol.id}`}
                      className="text-[#003366] hover:underline font-medium text-xs"
                    >
                      Ver →
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{label}:</span>
      {children}
    </div>
  )
}

function FilterLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <a
      href={href}
      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
        active
          ? 'bg-[#003366] text-white'
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
      }`}
    >
      {label}
    </a>
  )
}
