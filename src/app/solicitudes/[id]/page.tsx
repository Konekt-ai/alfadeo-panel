import { supabase } from '@/lib/supabase'
import type { Solicitud } from '@/lib/types'
import { estadoLabel, estadoColor, urgenciaColor, tipoClienteLabel, canalLabel, formatDate } from '@/lib/utils'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeftIcon, ExclamationTriangleIcon, PhoneIcon, EnvelopeIcon, ArrowDownTrayIcon, DocumentTextIcon } from '@heroicons/react/20/solid'

export const dynamic = 'force-dynamic'

export default async function DetalleSolicitudPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [{ data, error }, { data: cotizaciones }] = await Promise.all([
    supabase
      .from('solicitudes')
      .select(`
        id, folio, canal, estado, urgencia, ciudad_entrega, responsable,
        requiere_humano, notas, created_at, updated_at,
        clientes ( id, nombre, empresa, tipo, ciudad, telefono_wa, correo, created_at ),
        solicitud_items ( id, descripcion_libre, cantidad, unidad, nota, producto_id )
      `)
      .eq('id', id)
      .single(),
    supabase
      .from('cotizaciones')
      .select('id, folio, estado, total, created_at')
      .eq('solicitud_id', id)
      .order('created_at', { ascending: false }),
  ])

  if (error || !data) return notFound()

  const sol = data as unknown as Solicitud

  return (
    <div className="p-8 max-w-4xl">
      {/* Back */}
      <Link href="/solicitudes" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 transition-colors mb-6">
        <ArrowLeftIcon className="w-3.5 h-3.5" />
        Solicitudes
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-gray-900">Solicitud <span className="font-mono">#{sol.folio}</span></h1>
            {sol.requiere_humano && (
              <span className="inline-flex items-center gap-1 text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-1 rounded-full">
                <ExclamationTriangleIcon className="w-3 h-3" />
                Requiere atención
              </span>
            )}
          </div>
          <p className="text-sm text-gray-400 mt-1">{formatDate(sol.created_at)} · {canalLabel(sol.canal)}</p>
        </div>
        <div className="flex gap-2 shrink-0 items-center">
          <span className={`px-3 py-1.5 rounded-full text-xs font-medium ${estadoColor(sol.estado)}`}>
            {estadoLabel(sol.estado)}
          </span>
          <span className={`px-3 py-1.5 rounded-full text-xs font-medium ${urgenciaColor(sol.urgencia)}`}>
            {sol.urgencia}
          </span>
          {sol.estado !== 'cancelada' && sol.estado !== 'facturada' && (
            <Link
              href={`/solicitudes/${sol.id}/cotizar`}
              className="px-4 py-1.5 bg-[#003366] text-white text-xs font-medium rounded-lg hover:bg-[#002244] transition-colors"
            >
              {(cotizaciones ?? []).length > 0 ? 'Nueva cotización' : 'Cotizar'}
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 mb-5">
        {/* Cliente */}
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-5">Datos del cliente</h2>
          <dl className="space-y-4">
            <Field label="Nombre" value={sol.clientes?.nombre} />
            <Field label="Empresa" value={sol.clientes?.empresa} />
            <Field label="Tipo" value={tipoClienteLabel(sol.clientes?.tipo ?? null)} />
            <Field label="Ciudad" value={sol.clientes?.ciudad} />
            <div>
              <dt className="text-xs text-gray-400 mb-1">Teléfono / WhatsApp</dt>
              <dd>
                {sol.clientes?.telefono_wa ? (
                  <a
                    href={`https://wa.me/${sol.clientes.telefono_wa}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-700 hover:text-teal-800 transition-colors"
                  >
                    <PhoneIcon className="w-3.5 h-3.5" />
                    {sol.clientes.telefono_wa}
                  </a>
                ) : <span className="text-gray-300 text-sm">—</span>}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-400 mb-1">Correo electrónico</dt>
              <dd>
                {sol.clientes?.correo ? (
                  <a
                    href={`mailto:${sol.clientes.correo}`}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-[#003366] hover:underline transition-colors"
                  >
                    <EnvelopeIcon className="w-3.5 h-3.5" />
                    {sol.clientes.correo}
                  </a>
                ) : <span className="text-gray-300 text-sm">—</span>}
              </dd>
            </div>
          </dl>
        </div>

        {/* Solicitud */}
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-5">Datos de la solicitud</h2>
          <dl className="space-y-4">
            <Field label="Canal de origen" value={canalLabel(sol.canal)} />
            <Field label="Ciudad de entrega" value={sol.ciudad_entrega} />
            <Field label="Responsable asignado" value={sol.responsable} />
            <Field label="Última actualización" value={formatDate(sol.updated_at)} />
            {sol.notas && (
              <div>
                <dt className="text-xs text-gray-400 mb-1.5">Notas internas</dt>
                <dd className="text-sm text-gray-700 bg-amber-50 border border-amber-100 rounded-lg p-3 leading-relaxed">
                  {sol.notas}
                </dd>
              </div>
            )}
          </dl>
        </div>
      </div>

      {/* Items */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Productos solicitados
            <span className="ml-2 text-gray-300 font-normal normal-case tracking-normal">
              ({sol.solicitud_items?.length ?? 0})
            </span>
          </h2>
        </div>
        {!sol.solicitud_items?.length ? (
          <div className="px-6 py-10 text-center text-gray-300 text-sm">Sin items registrados.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50/60 border-b border-gray-100">
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-10">#</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Descripción</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Cantidad</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Nota</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sol.solicitud_items.map((item, i) => (
                <tr key={item.id}>
                  <td className="px-6 py-4 text-gray-300 font-mono text-xs">{String(i + 1).padStart(2, '0')}</td>
                  <td className="px-6 py-4 text-gray-900 font-medium">{item.descripcion_libre ?? '—'}</td>
                  <td className="px-6 py-4 text-gray-600">
                    {item.cantidad != null ? `${item.cantidad}${item.unidad ? ` ${item.unidad}` : ''}` : '—'}
                  </td>
                  <td className="px-6 py-4 text-gray-400">{item.nota ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Cotizaciones */}
      {(cotizaciones ?? []).length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mt-5">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
            <DocumentTextIcon className="w-4 h-4 text-gray-300" />
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Cotizaciones</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50/60 border-b border-gray-100">
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Folio</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Estado</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Total</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Fecha</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(cotizaciones ?? []).map((cot: any) => (
                <tr key={cot.id}>
                  <td className="px-6 py-4 font-mono text-xs text-gray-700">{cot.folio}</td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
                      {cot.estado}
                    </span>
                  </td>
                  <td className="px-6 py-4 font-medium text-gray-900 tabular-nums">
                    {Number(cot.total).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}
                  </td>
                  <td className="px-6 py-4 text-gray-400 text-xs">{formatDate(cot.created_at)}</td>
                  <td className="px-6 py-4 text-right">
                    <a
                      href={`/api/cotizaciones/${cot.id}/pdf`}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-[#003366] hover:text-[#002244] transition-colors"
                    >
                      <ArrowDownTrayIcon className="w-3.5 h-3.5" />
                      Descargar PDF
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-gray-400 mb-0.5">{label}</dt>
      <dd className="text-sm font-medium text-gray-800">{value ?? <span className="text-gray-300 font-normal">—</span>}</dd>
    </div>
  )
}
