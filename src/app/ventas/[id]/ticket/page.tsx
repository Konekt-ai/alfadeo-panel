import { notFound } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { pesos, formatDia } from '@/lib/utils'
import type { VentaCobranza, VentaItem, Lote } from '@/lib/types'
import Autoimprimir from './Autoimprimir'

export const dynamic = 'force-dynamic'

// Ticket para la impresora térmica POS-58 que ya tienen en el mostrador.
//
// 58 mm de papel dan ~48 mm imprimibles. Por eso la hoja se declara de 58 mm
// y todo va en una sola columna de texto monoespaciado: en una térmica no hay
// colores ni medias tintas, sólo negro sobre papel.
//
// Se imprime desde el navegador (Ctrl+P / diálogo automático). No se usa
// ESC/POS ni driver directo: eso obligaría a un servicio corriendo en la PC, y
// la decisión fue que el panel viva en la nube y esta máquina sea sólo
// terminal.

const CSS = `
  @page { size: 58mm auto; margin: 0; }
  html, body { background: #fff; }
  .ticket {
    width: 54mm;
    margin: 0 auto;
    padding: 2mm 2mm 8mm;
    font-family: ui-monospace, "Cascadia Mono", "Consolas", monospace;
    font-size: 10.5px;
    line-height: 1.35;
    color: #000;
  }
  .ticket .c   { text-align: center; }
  .ticket .r   { text-align: right; }
  .ticket .b   { font-weight: 700; }
  .ticket .g   { font-size: 13px; font-weight: 700; }
  .ticket hr   { border: none; border-top: 1px dashed #000; margin: 2mm 0; }
  .ticket table { width: 100%; border-collapse: collapse; }
  .ticket td   { vertical-align: top; padding: 0; }
  .ticket .lote { font-size: 9px; }
  @media print {
    .no-print { display: none !important; }
    .ticket { padding-bottom: 2mm; }
  }
  @media screen {
    body { background: #f3f4f6; }
    .ticket {
      background: #fff; margin: 24px auto; box-shadow: 0 1px 6px rgba(0,0,0,.15);
      padding: 6mm 3mm;
    }
  }
`

export default async function TicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ auto?: string }>
}) {
  const { id } = await params
  const { auto } = await searchParams

  const [ventaRes, itemsRes] = await Promise.all([
    supabase.from('v_ventas_cobranza').select('*').eq('venta_id', id).maybeSingle(),
    supabase.from('venta_items').select('*').eq('venta_id', id).order('posicion'),
  ])

  const venta = ventaRes.data as VentaCobranza | null
  if (!venta) notFound()

  const items = (itemsRes.data ?? []) as VentaItem[]

  // Los datos fiscales de la plaza: son empresas distintas y el ticket tiene
  // que decir cuál vendió (minuta 9).
  const { data: suc } = await supabase
    .from('sucursales')
    .select('nombre, razon_social, rfc, ciudad, telefono_wa')
    .eq('id', venta.sucursal_id ?? '')
    .maybeSingle()

  const hayIva = items.some(i => Number(i.iva) > 0)

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <Autoimprimir auto={auto === '1'} />

      <div className="ticket">
        <div className="c b g">{suc?.razon_social ?? suc?.nombre ?? 'ALFA-DEO'}</div>
        {suc?.rfc && <div className="c">RFC {suc.rfc}</div>}
        {suc?.ciudad && <div className="c">{suc.ciudad}</div>}
        {suc?.telefono_wa && <div className="c">Tel {suc.telefono_wa}</div>}

        <hr />

        <div><span className="b">Folio:</span> {venta.folio ?? '—'}</div>
        <div><span className="b">Fecha:</span> {new Date(venta.fecha).toLocaleString('es-MX', {
          day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
        })}</div>
        <div>
          <span className="b">Cliente:</span>{' '}
          {venta.cliente_empresa ?? venta.cliente_nombre ?? 'Mostrador'}
        </div>
        {venta.usuario && <div><span className="b">Atendió:</span> {venta.usuario}</div>}

        <hr />

        <table>
          <tbody>
            {items.map(it => {
              const lotes: Lote[] = Array.isArray(it.lotes) ? it.lotes : []
              return (
                <tr key={it.id}>
                  <td colSpan={2}>
                    <div>{it.descripcion}</div>
                    {/* El lote y la caducidad van en el ticket porque en
                        farmacia es lo que se pide en una devolución o un
                        retiro de lote (minuta 23). */}
                    {lotes.map((l, j) => (
                      <div key={j} className="lote">
                        &nbsp;&nbsp;lote {l.lote ?? 's/l'}
                        {l.caducidad && ` · cad ${formatDia(l.caducidad)}`}
                      </div>
                    ))}
                    <table>
                      <tbody>
                        <tr>
                          <td>
                            &nbsp;&nbsp;{Number(it.cantidad)} x {pesos(it.precio_unitario)}
                            {Number(it.descuento_pct) > 0 && ` −${Number(it.descuento_pct)}%`}
                          </td>
                          <td className="r b">{pesos(it.total)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <hr />

        <table>
          <tbody>
            <tr><td>Subtotal</td><td className="r">{pesos(venta.total - items.reduce((s, i) => s + Number(i.iva), 0))}</td></tr>
            {/* La mayoría de sus productos no causa IVA; se dice explícito
                para que nadie lo busque en el ticket (minuta 3). */}
            <tr>
              <td>IVA</td>
              <td className="r">{pesos(items.reduce((s, i) => s + Number(i.iva), 0))}</td>
            </tr>
            <tr><td className="b g">TOTAL</td><td className="r b g">{pesos(venta.total)}</td></tr>
          </tbody>
        </table>

        {!hayIva && <div className="c lote">Productos con IVA tasa 0%</div>}

        <hr />

        <div>
          <span className="b">Pago:</span> {venta.forma_pago}
          {venta.forma_pago === 'credito' && venta.fecha_vencimiento &&
            ` · vence ${formatDia(venta.fecha_vencimiento)}`}
        </div>
        {/* Lo que se le prometió al cliente, impreso: es el punto 6 de la
            minuta, decir el tiempo de entrega desde el principio. */}
        {venta.fecha_entrega && (
          <div><span className="b">Entrega:</span> {formatDia(venta.fecha_entrega)}</div>
        )}
        {venta.requiere_factura && (
          <div className="lote">Requiere factura — se envía por correo.</div>
        )}

        <hr />
        <div className="c">¡Gracias por su compra!</div>
        <div className="c lote">{venta.folio ?? ''}</div>
      </div>
    </>
  )
}
