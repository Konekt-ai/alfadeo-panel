import { supabase } from '@/lib/supabase'
import type { Solicitud } from '@/lib/types'
import { estadoLabel, estadoColor, urgenciaColor, tipoClienteLabel, canalLabel, formatDate } from '@/lib/utils'
import Link from 'next/link'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function DetalleSolicitudPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data, error } = await supabase
    .from('solicitudes')
    .select(`
      id, folio, canal, estado, urgencia, ciudad_entrega, responsable,
      requiere_humano, notas, created_at, updated_at,
      clientes ( id, nombre, empresa, tipo, ciudad, telefono_wa, correo, created_at ),
      solicitud_items ( id, descripcion_libre, cantidad, unidad, nota, producto_id )
    `)
    .eq('id', id)
    .single()

  if (error || !data) return notFound()

  const sol = data as unknown as Solicitud

  return (
    <div className="p-6 max-w-4xl">
      {/* Header */}
      <div className="mb-6">
        <Link href="/solicitudes" className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 mb-3">
          ← Volver a solicitudes
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Solicitud #{sol.folio}
              {sol.requiere_humano && (
                <span className="ml-2 text-sm bg-red-100 text-red-700 px-2 py-0.5 rounded-full align-middle font-medium">
                  🚨 Requiere atención
                </span>
              )}
            </h1>
            <p className="text-sm text-gray-500 mt-1">{formatDate(sol.created_at)}</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${estadoColor(sol.estado)}`}>
              {estadoLabel(sol.estado)}
            </span>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${urgenciaColor(sol.urgencia)}`}>
              {sol.urgencia}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {/* Datos del cliente */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">Datos del cliente</h2>
          <dl className="space-y-3">
            <Row label="Nombre" value={sol.clientes?.nombre} />
            <Row label="Empresa" value={sol.clientes?.empresa} />
            <Row label="Tipo" value={tipoClienteLabel(sol.clientes?.tipo ?? null)} />
            <Row label="Ciudad" value={sol.clientes?.ciudad} />
            <Row
              label="Teléfono / WA"
              value={
                sol.clientes?.telefono_wa
                  ? <a
                      href={`https://wa.me/${sol.clientes.telefono_wa}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-green-700 hover:underline font-mono"
                    >
                      {sol.clientes.telefono_wa}
                    </a>
                  : null
              }
            />
            <Row
              label="Correo"
              value={
                sol.clientes?.correo
                  ? <a href={`mailto:${sol.clientes.correo}`} className="text-[#003366] hover:underline">
                      {sol.clientes.correo}
                    </a>
                  : null
              }
            />
          </dl>
        </div>

        {/* Datos de la solicitud */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">Datos de la solicitud</h2>
          <dl className="space-y-3">
            <Row label="Canal" value={canalLabel(sol.canal)} />
            <Row label="Ciudad de entrega" value={sol.ciudad_entrega} />
            <Row label="Responsable" value={sol.responsable} />
            <Row label="Última actualización" value={formatDate(sol.updated_at)} />
            {sol.notas && (
              <div>
                <dt className="text-xs text-gray-400 mb-1">Notas</dt>
                <dd className="text-sm text-gray-700 bg-yellow-50 border border-yellow-100 rounded-lg p-3">
                  {sol.notas}
                </dd>
              </div>
            )}
          </dl>
        </div>
      </div>

      {/* Items */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mt-5">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">
          Productos solicitados ({sol.solicitud_items?.length ?? 0})
        </h2>
        {!sol.solicitud_items?.length ? (
          <p className="text-sm text-gray-400">Sin items registrados.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-2 pr-4 font-medium text-gray-600">#</th>
                <th className="text-left py-2 pr-4 font-medium text-gray-600">Descripción</th>
                <th className="text-left py-2 pr-4 font-medium text-gray-600">Cantidad</th>
                <th className="text-left py-2 font-medium text-gray-600">Nota</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sol.solicitud_items.map((item, i) => (
                <tr key={item.id}>
                  <td className="py-2.5 pr-4 text-gray-400">{i + 1}</td>
                  <td className="py-2.5 pr-4 text-gray-900">{item.descripcion_libre ?? '—'}</td>
                  <td className="py-2.5 pr-4 text-gray-700">
                    {item.cantidad != null ? `${item.cantidad} ${item.unidad ?? ''}`.trim() : '—'}
                  </td>
                  <td className="py-2.5 text-gray-500">{item.nota ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <dt className="text-xs text-gray-400 w-32 shrink-0 pt-0.5">{label}</dt>
      <dd className="text-sm text-gray-800 font-medium flex-1">{value ?? <span className="text-gray-300">—</span>}</dd>
    </div>
  )
}
