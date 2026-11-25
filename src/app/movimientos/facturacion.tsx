// La factura del documento que originó un movimiento (punto 5): la venta
// para las salidas por venta, la compra para las entradas de proveedor.
// Se lee de la venta o compra, así que en cuanto se liga la factura, todos
// sus movimientos aparecen como facturados.
//
// Lo usan Movimientos y el historial de la ficha del producto: la misma
// consulta y el mismo pintado en los dos lados.

import { formatDia } from '@/lib/utils'
import type { Movimiento } from '@/lib/types'

export interface Facturacion {
  /** null = el movimiento no viene de una venta ni de una compra (ajuste, traslado...). */
  fact_doc: 'venta' | 'compra' | null
  fact_doc_id: string | null
  fact_doc_folio: string | null
  fact_uuid: string | null
  fact_serie: string | null
  fact_folio: string | null
  fact_fecha: string | null
  fact_contraparte: string | null
  fact_emisor: string | null
}

export type MovimientoConFactura = Movimiento & Facturacion

/**
 * Columnas y joins para pegarle su factura a una consulta de v_movimientos
 * con alias `m`. `referencia_id` es el id del documento que originó el
 * movimiento; los uuid no se repiten entre tablas, así que no hace falta
 * fiarse del texto de `referencia_tipo`.
 */
export const COLUMNAS_FACTURA = `
  case when v.id is not null then 'venta'
       when c.id is not null then 'compra' end          as fact_doc,
  coalesce(v.id, c.id)                                   as fact_doc_id,
  coalesce(v.folio, c.folio)                             as fact_doc_folio,
  coalesce(v.factura_uuid, c.factura_uuid)::text         as fact_uuid,
  coalesce(v.factura_serie, c.factura_serie)             as fact_serie,
  coalesce(v.factura_folio, c.factura_folio)             as fact_folio,
  case when v.id is not null then v.facturado_en::text
       else c.fecha::text end                            as fact_fecha,
  case when v.id is not null
       then coalesce(cl.razon_social, cl.empresa, cl.nombre)
       else coalesce(pr.nombre, c.emisor_nombre) end     as fact_contraparte,
  v.factura_emisor                                       as fact_emisor`

export const JOINS_FACTURA = `
  left join ventas      v  on v.id  = m.referencia_id
  left join compras     c  on c.id  = m.referencia_id
  left join clientes    cl on cl.id = v.cliente_id
  left join proveedores pr on pr.id = c.proveedor_id`

const EMISOR_FACTURA: Record<string, string> = {
  aspel: 'Aspel', interno: 'este sistema', contalink: 'Contalink', otro: 'otro sistema',
}

export const facturacion = (m: MovimientoConFactura) => {
  if (!m.fact_doc) return <span className="text-sm text-gray-300">—</span>

  const documento = (
    <a href={`/${m.fact_doc === 'venta' ? 'ventas' : 'compras'}/${m.fact_doc_id}`}
      className="text-[#003366] hover:underline">
      {m.fact_doc === 'venta' ? 'Venta' : 'Compra'} {m.fact_doc_folio ?? ''}
    </a>
  )

  if (!m.fact_uuid) {
    return (
      <div className="text-sm">
        <span className="inline-block font-semibold px-2.5 py-1 rounded-md whitespace-nowrap bg-amber-100 text-amber-800">
          No facturado
        </span>
        <div className="text-gray-500 mt-1">{documento}</div>
      </div>
    )
  }

  const folio = [m.fact_serie, m.fact_folio].filter(Boolean).join('-')
  return (
    <div className="text-sm">
      <span className="inline-block font-semibold px-2.5 py-1 rounded-md whitespace-nowrap bg-emerald-100 text-emerald-800">
        Facturado
      </span>
      <div className="text-gray-700 mt-1 break-words">
        Factura {folio || <span className="font-mono">{m.fact_uuid.slice(0, 8)}…</span>}
        {m.fact_emisor && EMISOR_FACTURA[m.fact_emisor] && (
          <span className="text-gray-500"> · {EMISOR_FACTURA[m.fact_emisor]}</span>
        )}
      </div>
      <div className="text-gray-500 break-words">
        {[m.fact_contraparte, m.fact_fecha && formatDia(m.fact_fecha.slice(0, 10))].filter(Boolean).join(' · ')}
      </div>
      <div className="text-gray-500">{documento}</div>
    </div>
  )
}
