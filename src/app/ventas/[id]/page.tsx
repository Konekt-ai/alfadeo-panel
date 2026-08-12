import Link from 'next/link'
import { notFound } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { pesos, formatDia, formatDate, cobranzaLabel, cobranzaColor, formaPagoLabel } from '@/lib/utils'
import type { VentaCobranza, VentaItem, Pago, Lote } from '@/lib/types'
import { ArrowLeftIcon, DocumentTextIcon } from '@heroicons/react/20/solid'
import AccionesVenta from './AccionesVenta'

export const dynamic = 'force-dynamic'

const EMISOR: Record<string, string> = {
  interno: 'Timbrada desde el sistema',
  aspel: 'Timbrada en Aspel',
  contalink: 'Timbrada en Contalink',
  otro: 'Timbrada en otro sistema',
}

const CANALES: Record<string, string> = {
  pos: 'Mostrador', panel: 'Panel', whatsapp: 'WhatsApp', web: 'Web',
}

export default async function VentaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [ventaRes, itemsRes, pagosRes] = await Promise.all([
    supabase.from('v_ventas_cobranza').select('*').eq('venta_id', id).maybeSingle(),
    supabase.from('venta_items').select('*').eq('venta_id', id).order('posicion'),
    supabase.from('pagos').select('*').eq('venta_id', id).order('fecha', { ascending: false }),
  ])

  // Si la vista todavía no existe es que falta la migración; se distingue de
  // "la venta no existe" para no mandar un 404 engañoso.
  const errorEsquema = ventaRes.error && /relation|column|function|schema cache|does not exist|no existe/i.test(ventaRes.error.message)
  if (errorEsquema) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-base">
          {ventaRes.error?.message}
          <p className="mt-2 text-sm">
            Falta correr <code className="font-mono">supabase/reunion-operacion.sql</code> en el SQL Editor de Supabase.
          </p>
        </div>
      </div>
    )
  }

  const venta = ventaRes.data as VentaCobranza | null
  if (!venta) notFound()

  const items = (itemsRes.data ?? []) as VentaItem[]
  const pagos = (pagosRes.data ?? []) as Pago[]

  const detalle = 'bg-white border border-gray-200 rounded-xl'
  const dato = (label: string, valor: React.ReactNode) => (
    <div>
      <div className="text-sm font-semibold text-gray-500 uppercase tracking-wide">{label}</div>
      <div className="text-base text-gray-900 mt-0.5">{valor}</div>
    </div>
  )

  return (
    <div className="p-8">
      <Link href="/ventas" className="inline-flex items-center gap-1.5 text-base text-gray-500 hover:text-gray-900 transition-colors mb-4">
        <ArrowLeftIcon className="w-4 h-4" />
        Ventas
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold text-gray-900">{venta.folio ?? 'Venta'}</h1>
            <span className={`text-sm font-medium px-2.5 py-1 rounded-md ${cobranzaColor(venta.estado_cobranza)}`}>
              {cobranzaLabel(venta.estado_cobranza)}
            </span>
            {venta.sucursal && (
              <span className={`text-sm font-semibold px-2.5 py-1 rounded-md ${
                venta.sucursal === 'GDL' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'
              }`}>
                {venta.sucursal}
              </span>
            )}
          </div>
          <p className="text-base text-gray-500 mt-1">
            {formatDate(venta.fecha)} · {CANALES[venta.canal] ?? venta.canal}
            {venta.usuario && ` · ${venta.usuario}`}
          </p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-semibold text-gray-900">{pesos(venta.total)}</div>
          {Number(venta.saldo) > 0.005 && venta.estado !== 'cancelada' && (
            <div className="text-base text-red-600 font-medium mt-0.5">
              Saldo {pesos(venta.saldo)}
            </div>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_360px] gap-6 items-start">
        <div className="space-y-6">
          {/* Datos de la venta */}
          <div className={`${detalle} p-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-5`}>
            {dato('Cliente', venta.cliente_id ? (
              <Link href={`/cobranza/${venta.cliente_id}`} className="text-[#003366] hover:underline font-medium">
                {venta.cliente_empresa ?? venta.cliente_nombre ?? 'Sin nombre'}
              </Link>
            ) : <span className="text-gray-400">Mostrador</span>)}
            {dato('Forma de pago', formaPagoLabel(venta.forma_pago) +
              (venta.dias_credito > 0 ? ` · ${venta.dias_credito} días` : ''))}
            {dato('Vence', venta.fecha_vencimiento
              ? <span className={venta.estado_cobranza === 'vencida' ? 'text-red-600 font-medium' : ''}>
                  {formatDia(venta.fecha_vencimiento)}
                  {venta.dias_vencida > 0 && ` · ${venta.dias_vencida} días de atraso`}
                </span>
              : <span className="text-gray-400">—</span>)}
            {/* Lo que se le prometió al cliente (minuta 5, 6). */}
            {dato('Entrega comprometida', venta.fecha_entrega
              ? formatDia(venta.fecha_entrega)
              : <span className="text-gray-400">—</span>)}
            {dato('Pagado', pesos(venta.pagado))}
            {dato('Saldo', <span className={Number(venta.saldo) > 0.005 ? 'font-semibold text-red-600' : ''}>
              {pesos(venta.saldo)}
            </span>)}
          </div>

          {/* Factura */}
          <div className={`${detalle} p-5`}>
            <div className="flex items-center gap-2 mb-3">
              <DocumentTextIcon className="w-5 h-5 text-gray-400" />
              <h2 className="text-lg font-semibold text-gray-900">Factura</h2>
            </div>
            {venta.factura_uuid ? (
              <div className="grid sm:grid-cols-2 gap-5">
                {dato('Quién timbró', EMISOR[venta.factura_emisor ?? ''] ?? venta.factura_emisor)}
                {dato('Folio fiscal', <span className="font-mono text-sm break-all">{venta.factura_uuid}</span>)}
              </div>
            ) : (
              <p className="text-base text-gray-500">
                Sin factura registrada.
                {venta.requiere_factura && (
                  <span className="text-amber-700 font-medium"> El cliente la pidió.</span>
                )}
                {/* Grajes y otros facturan con su propio sistema (minuta 36). */}
                {venta.factura_externa && (
                  <span className="block mt-1 text-sm text-gray-500">
                    Este cliente factura con {venta.factura_externa}.
                  </span>
                )}
              </p>
            )}
          </div>

          {/* Partidas */}
          <div className={`${detalle} overflow-hidden`}>
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">Partidas</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-base min-w-[720px]">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Producto</th>
                    <th className="text-right px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Cant.</th>
                    <th className="text-right px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Precio</th>
                    <th className="text-right px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Desc.</th>
                    <th className="text-right px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">IVA</th>
                    <th className="text-right px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Importe</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {items.length === 0 && (
                    <tr><td colSpan={6} className="text-center py-20 text-gray-400 text-base">Sin partidas.</td></tr>
                  )}
                  {items.map(it => {
                    const lotes: Lote[] = Array.isArray(it.lotes) ? it.lotes : []
                    return (
                      <tr key={it.id}>
                        <td className="px-5 py-4">
                          <div className="font-medium text-gray-900">{it.descripcion}</div>
                          {/* De qué lote salió: es la trazabilidad que exige
                              farmacia (minuta 23). */}
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-sm text-gray-500">
                            {lotes.length === 0 && <span>—</span>}
                            {lotes.map((l, j) => (
                              <span key={j} className="font-mono">
                                {l.lote ?? 's/l'} · {Number(l.cantidad ?? 0)} pz
                                {l.caducidad && ` · cad. ${formatDia(l.caducidad)}`}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-5 py-4 text-right text-gray-700 whitespace-nowrap">{Number(it.cantidad)}</td>
                        <td className="px-5 py-4 text-right text-gray-700 whitespace-nowrap">{pesos(it.precio_unitario)}</td>
                        <td className="px-5 py-4 text-right text-gray-500 whitespace-nowrap">
                          {Number(it.descuento_pct) > 0 ? `${Number(it.descuento_pct)}%` : '—'}
                        </td>
                        <td className="px-5 py-4 text-right whitespace-nowrap">
                          {/* La tasa quedó congelada al vender (minuta 3). */}
                          {Number(it.tasa_iva) === 0
                            ? <span className="text-emerald-700 font-medium text-sm">0%</span>
                            : <span className="text-gray-700">{(Number(it.tasa_iva) * 100).toFixed(0)}%</span>}
                        </td>
                        <td className="px-5 py-4 text-right font-medium text-gray-900 whitespace-nowrap">
                          {pesos(it.total)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-4 bg-gray-50 border-t border-gray-200">
              <div className="ml-auto max-w-xs space-y-1">
                <div className="flex justify-between text-base text-gray-600">
                  <span>Subtotal</span>
                  <span>{pesos(items.reduce((s, i) => s + Number(i.subtotal), 0))}</span>
                </div>
                <div className="flex justify-between text-base text-gray-600">
                  <span>IVA</span>
                  <span>{pesos(items.reduce((s, i) => s + Number(i.iva), 0))}</span>
                </div>
                <div className="flex justify-between text-xl font-semibold text-gray-900 pt-1">
                  <span>Total</span><span>{pesos(venta.total)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Pagos */}
          <div className={`${detalle} overflow-hidden`}>
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">Pagos</h2>
            </div>
            {pagos.length === 0 ? (
              <div className="py-12 text-center text-gray-400 text-base">Sin pagos registrados.</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {pagos.map(p => (
                  <div key={p.id} className="px-5 py-4 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-medium text-base text-gray-900">{pesos(p.monto)}</div>
                      <div className="text-sm text-gray-500">
                        {formatDia(p.fecha)} · {p.metodo}
                        {p.referencia && ` · ${p.referencia}`}
                        {p.usuario && ` · ${p.usuario}`}
                      </div>
                    </div>
                    {p.origen !== 'manual' && (
                      <span className="text-sm text-gray-400 shrink-0">vía {p.origen}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-4">
            <Link
              href={`/movimientos?referencia=${venta.venta_id}`}
              className="text-base font-medium text-[#003366] hover:underline"
            >
              Ver los movimientos de inventario de esta venta →
            </Link>
            {/* Reimprimir en la térmica del mostrador. */}
            <Link
              href={`/ventas/${venta.venta_id}/ticket`}
              target="_blank"
              className="text-base font-medium text-[#003366] hover:underline"
            >
              Imprimir ticket →
            </Link>
          </div>
        </div>

        {/* Acciones */}
        <AccionesVenta
          ventaId={venta.venta_id}
          estado={venta.estado}
          saldo={Number(venta.saldo)}
          tieneFactura={Boolean(venta.factura_uuid)}
          tienePagos={pagos.length > 0}
          facturaExterna={venta.factura_externa}
        />
      </div>
    </div>
  )
}
