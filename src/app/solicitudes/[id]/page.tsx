import { sql, uno } from '@/lib/db'
import type { Solicitud } from '@/lib/types'
import { estadoLabel, estadoColor, urgenciaColor, tipoClienteLabel, canalLabel, formatDate } from '@/lib/utils'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeftIcon, ExclamationTriangleIcon, PhoneIcon, EnvelopeIcon, ArrowDownTrayIcon, DocumentTextIcon } from '@heroicons/react/20/solid'

export const dynamic = 'force-dynamic'

export default async function DetalleSolicitudPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [{ data: sol, error }, { data: cotizaciones }] = await Promise.all([
    uno<Solicitud>(
      `select s.id, s.folio, s.canal, s.estado, s.urgencia, s.ciudad_entrega,
              s.responsable, s.requiere_humano, s.notas, s.created_at, s.updated_at,
              s.nivel_urgencia, s.tiempo_entrega, s.vigencia_cotizacion,
              s.direccion_entrega, s.acepta_seguimiento,
              case when c.id is null then null else
                json_build_object(
                  'id', c.id, 'nombre', c.nombre, 'empresa', c.empresa,
                  'tipo', c.tipo, 'ciudad', c.ciudad, 'telefono_wa', c.telefono_wa,
                  'correo', c.correo, 'created_at', c.created_at,
                  'telefono', c.telefono, 'direccion', c.direccion,
                  'puesto', c.puesto, 'especificacion', c.especificacion,
                  'rfc', c.rfc)
              end as clientes,
              coalesce((
                select json_agg(json_build_object(
                         'id', si.id, 'descripcion_libre', si.descripcion_libre,
                         'cantidad', si.cantidad, 'unidad', si.unidad,
                         'nota', si.nota, 'producto_id', si.producto_id,
                         'categoria', si.categoria, 'marca', si.marca,
                         'presentacion', si.presentacion))
                  from solicitud_items si where si.solicitud_id = s.id
              ), '[]'::json) as solicitud_items
         from solicitudes s
         left join clientes c on c.id = s.cliente_id
        where s.id = $1::uuid`,
      [id]
    ),
    sql<{ id: string; folio: string; estado: string; total: number; created_at: string }>(
      `select id, folio, estado, total, created_at
         from cotizaciones
        where solicitud_id = $1::uuid
        order by created_at desc`,
      [id]
    ),
  ])

  if (error || !sol) return notFound()

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      {/* Back */}
      <Link href="/solicitudes" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 transition-colors mb-5">
        <ArrowLeftIcon className="w-3.5 h-3.5" />
        Solicitudes
      </Link>

      {/* Header */}
      <div className="mb-6 md:mb-8">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
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
          <div className="flex gap-2 items-center flex-wrap">
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
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 mb-5">
        {/* Cliente */}
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-5">Datos del cliente</h2>
          <dl className="space-y-4">
            <Field label="Nombre" value={sol.clientes?.nombre} />
            <Field label="Puesto" value={sol.clientes?.puesto} />
            <Field label="Empresa" value={sol.clientes?.empresa} />
            <Field label="Tipo" value={tipoClienteLabel(sol.clientes?.tipo ?? null)} />
            <Field label="Especificación" value={sol.clientes?.especificacion} />
            <Field label="RFC" value={sol.clientes?.rfc} />
            <Field label="Ciudad" value={sol.clientes?.ciudad} />
            <Field label="Dirección de la empresa" value={sol.clientes?.direccion} />
            <Field label="Teléfono" value={sol.clientes?.telefono} />
            <div>
              <dt className="text-xs text-gray-400 mb-1">WhatsApp</dt>
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
            <Field
              label="Nivel de urgencia indicado"
              value={sol.nivel_urgencia}
            />
            <Field label="Tiempo de entrega requerido" value={sol.tiempo_entrega} />
            <Field label="Vigencia solicitada para la cotización" value={sol.vigencia_cotizacion} />
            <Field label="Ciudad de entrega" value={sol.ciudad_entrega} />
            <Field label="Dirección de entrega" value={sol.direccion_entrega} />
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
        <div className="px-4 md:px-6 py-4 border-b border-gray-100">
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
          <div className="overflow-x-auto overscroll-x-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
          <table className="w-full text-sm" style={{ minWidth: '480px' }}>
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
                  <td className="px-6 py-4">
                    <div className="text-gray-900 font-medium">{item.descripcion_libre ?? '—'}</div>
                    {(item.categoria || item.marca || item.presentacion) && (
                      <div className="text-xs text-gray-400 mt-1">
                        {[item.categoria, item.marca, item.presentacion].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 text-gray-600">
                    {item.cantidad != null ? `${item.cantidad}${item.unidad ? ` ${item.unidad}` : ''}` : '—'}
                  </td>
                  <td className="px-6 py-4 text-gray-400">{item.nota ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* Cotizaciones */}
      {(cotizaciones ?? []).length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mt-5">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
            <DocumentTextIcon className="w-4 h-4 text-gray-300" />
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Cotizaciones</h2>
          </div>
          <div className="overflow-x-auto overscroll-x-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
          <table className="w-full text-sm" style={{ minWidth: '520px' }}>
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
