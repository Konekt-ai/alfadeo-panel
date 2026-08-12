import Link from 'next/link'
import { notFound } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { pesos, formatDia } from '@/lib/utils'
import { ArrowLeftIcon } from '@heroicons/react/20/solid'
import RecibirCompra from './RecibirCompra'
import type { EstadoCompra, CompraItem } from '@/lib/types'

export const dynamic = 'force-dynamic'

const ESTADO: Record<string, { label: string; color: string }> = {
  borrador:  { label: 'Por recibir', color: 'bg-amber-100 text-amber-800' },
  recibida:  { label: 'Recibida',    color: 'bg-emerald-100 text-emerald-800' },
  cancelada: { label: 'Cancelada',   color: 'bg-gray-100 text-gray-500' },
}

interface CompraDetalle {
  id: string
  folio: string | null
  fecha: string
  estado: EstadoCompra
  subtotal: number
  iva: number
  total: number
  moneda: string
  factura_serie: string | null
  factura_folio: string | null
  factura_uuid: string | null
  emisor_rfc: string | null
  emisor_nombre: string | null
  xml_origen: string | null
  usuario: string | null
  notas: string | null
  proveedores: { nombre: string } | null
  sucursales: { clave: string; nombre: string } | null
}

export default async function CompraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [compraRes, itemsRes] = await Promise.all([
    supabase.from('compras').select(`
      id, folio, fecha, estado, subtotal, iva, total, moneda,
      factura_serie, factura_folio, factura_uuid, emisor_rfc, emisor_nombre,
      xml_origen, usuario, notas,
      proveedores ( nombre ),
      sucursales ( clave, nombre )
    `).eq('id', id).maybeSingle(),
    supabase.from('compra_items').select('*').eq('compra_id', id).order('posicion'),
  ])

  if (compraRes.error && /relation|column|function|schema cache|does not exist|no existe/i.test(compraRes.error.message)) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-base">
          {compraRes.error.message}
          <p className="mt-2 text-sm">
            Falta correr <code className="font-mono">supabase/reunion-operacion.sql</code> en el SQL Editor de Supabase.
          </p>
        </div>
      </div>
    )
  }

  const compra = compraRes.data as unknown as CompraDetalle | null
  if (!compra) notFound()

  const items = (itemsRes.data ?? []) as CompraItem[]
  const sinLigar = items.filter(i => !i.producto_id)
  const est = ESTADO[compra.estado] ?? { label: compra.estado, color: 'bg-gray-100 text-gray-700' }

  const dato = (label: string, valor: React.ReactNode) => (
    <div>
      <div className="text-sm font-semibold text-gray-500 uppercase tracking-wide">{label}</div>
      <div className="text-base text-gray-900 mt-0.5">{valor}</div>
    </div>
  )

  return (
    <div className="p-8">
      <Link href="/compras" className="inline-flex items-center gap-1.5 text-base text-gray-500 hover:text-gray-900 transition-colors mb-4">
        <ArrowLeftIcon className="w-4 h-4" />
        Compras
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold text-gray-900">{compra.folio ?? 'Compra'}</h1>
            <span className={`text-sm font-medium px-2.5 py-1 rounded-md ${est.color}`}>{est.label}</span>
            {compra.sucursales?.clave && (
              <span className={`text-sm font-semibold px-2.5 py-1 rounded-md ${
                compra.sucursales.clave === 'GDL' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'
              }`}>{compra.sucursales.clave}</span>
            )}
          </div>
          <p className="text-base text-gray-500 mt-1">
            {formatDia(compra.fecha)}
            {compra.usuario && ` · capturó ${compra.usuario}`}
          </p>
        </div>
        <div className="text-3xl font-semibold text-gray-900">{pesos(compra.total)}</div>
      </div>

      <div className="grid lg:grid-cols-[1fr_340px] gap-6 items-start">
        <div className="space-y-6">
          <div className="bg-white border border-gray-200 rounded-xl p-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {dato('Proveedor', compra.proveedores?.nombre ?? compra.emisor_nombre ?? <span className="text-gray-400">—</span>)}
            {dato('RFC', compra.emisor_rfc ?? <span className="text-gray-400">—</span>)}
            {dato('Factura', [compra.factura_serie, compra.factura_folio].filter(Boolean).join('-') || <span className="text-gray-400">—</span>)}
            {dato('Folio fiscal', compra.factura_uuid
              ? <span className="font-mono text-sm break-all">{compra.factura_uuid}</span>
              : <span className="text-gray-400">—</span>)}
            {dato('Moneda', compra.moneda)}
            {/* El XML se guarda tal cual para poder reprocesarlo (minuta 29). */}
            {dato('Origen', compra.xml_origen
              ? <span className="text-emerald-700 font-medium">Leída del XML del CFDI</span>
              : 'Captura manual')}
            {compra.notas && dato('Notas', compra.notas)}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">Partidas</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-base min-w-[860px]">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Descripción</th>
                    <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Lote</th>
                    <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Caducidad</th>
                    <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Ubicación</th>
                    <th className="text-right px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Cant.</th>
                    <th className="text-right px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Costo</th>
                    <th className="text-right px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Importe</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {items.length === 0 && (
                    <tr><td colSpan={7} className="text-center py-20 text-gray-400 text-base">Sin partidas.</td></tr>
                  )}
                  {items.map(it => (
                    <tr key={it.id} className={!it.producto_id ? 'bg-red-50/40' : undefined}>
                      <td className="px-5 py-4">
                        <div className="font-medium text-gray-900">{it.descripcion}</div>
                        <div className="text-sm mt-0.5">
                          {it.producto_id
                            ? <span className="text-gray-500">
                                Ligado al catálogo
                                {it.codigo_barras && ` · ${it.codigo_barras}`}
                              </span>
                            : <span className="text-red-600 font-medium">Sin ligar al catálogo</span>}
                        </div>
                      </td>
                      <td className="px-5 py-4 font-mono text-sm text-gray-600">{it.lote ?? '—'}</td>
                      <td className="px-5 py-4 text-gray-600 whitespace-nowrap">
                        {it.caducidad ? formatDia(it.caducidad) : '—'}
                      </td>
                      <td className="px-5 py-4 text-gray-500">{it.ubicacion ?? '—'}</td>
                      <td className="px-5 py-4 text-right text-gray-700">{Number(it.cantidad)}</td>
                      <td className="px-5 py-4 text-right text-gray-700 whitespace-nowrap">{pesos(it.costo_unitario)}</td>
                      <td className="px-5 py-4 text-right font-medium text-gray-900 whitespace-nowrap">
                        {pesos(Number(it.cantidad) * Number(it.costo_unitario))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-4 bg-gray-50 border-t border-gray-200">
              <div className="ml-auto max-w-xs space-y-1">
                <div className="flex justify-between text-base text-gray-600">
                  <span>Subtotal</span><span>{pesos(compra.subtotal)}</span>
                </div>
                <div className="flex justify-between text-base text-gray-600">
                  <span>IVA</span><span>{pesos(compra.iva)}</span>
                </div>
                <div className="flex justify-between text-xl font-semibold text-gray-900 pt-1">
                  <span>Total</span><span>{pesos(compra.total)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <RecibirCompra
          compraId={compra.id}
          estado={compra.estado}
          partidasSinLigar={sinLigar.map(i => i.descripcion)}
        />
      </div>
    </div>
  )
}
