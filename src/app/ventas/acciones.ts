'use server'

// Acciones del módulo administrativo de ventas (minutas 33, 7, 36, 3).
//
// Las tres cosas que se hacen sobre una venta ya cerrada:
//   1. registrarFactura  — timbrada por nosotros o por el sistema del cliente
//                          (Grajes con Contalink, minuta 36).
//   2. cancelarVenta     — el RPC regresa cada pieza a su lote.
//   3. registrarPago     — abono rápido desde el detalle (minuta 33).
//
// Ninguna lanza: devuelven `{ error }` y el componente lo pinta tal cual,
// porque los `raise exception` de Postgres ya vienen en español.

import { revalidatePath } from 'next/cache'
import { supabase } from '@/lib/supabase'
import { usuarioActual } from '@/lib/usuario'
import { pesos } from '@/lib/utils'
import type { EstadoVenta, FacturaEmisor, MetodoPago } from '@/lib/types'

type Resultado = { ok: true; mensaje: string } | { error: string }

const EMISORES: FacturaEmisor[] = ['interno', 'aspel', 'contalink', 'otro']
const METODOS: MetodoPago[] = ['efectivo', 'transferencia', 'tarjeta', 'cheque', 'compensacion']

// UUID del CFDI (folio fiscal). Se valida el formato para no mandar basura a
// una columna uuid de Postgres, que respondería con un error ilegible.
const UUID_CFDI = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/

function refrescar(ventaId: string) {
  revalidatePath('/ventas')
  revalidatePath(`/ventas/${ventaId}`)
}

/**
 * Registra los datos fiscales de una venta ya facturada.
 *
 * Sirve tanto si la timbramos nosotros como si la timbró el cliente con su
 * propio sistema (minuta 36): sólo se captura el comprobante, la venta no se
 * vuelve a capturar ni se toca el inventario.
 */
export async function registrarFactura(input: {
  ventaId: string
  emisor: string
  serie: string
  folio: string
  uuid: string
}): Promise<Resultado> {
  const emisor = input.emisor as FacturaEmisor
  if (!EMISORES.includes(emisor)) {
    return { error: 'Indica quién timbró la factura.' }
  }

  const uuid = input.uuid.trim()
  if (!uuid) return { error: 'Captura el UUID (folio fiscal) del CFDI.' }
  if (!UUID_CFDI.test(uuid)) {
    return { error: 'El UUID no tiene el formato de un folio fiscal (8-4-4-4-12). Cópialo del PDF o del XML.' }
  }

  const ahora = new Date().toISOString()
  const { data, error } = await supabase
    .from('ventas')
    .update({
      factura_emisor: emisor,
      factura_serie: input.serie.trim() || null,
      factura_folio: input.folio.trim() || null,
      factura_uuid: uuid,
      requiere_factura: true,
      facturado_en: ahora,
      updated_at: ahora,
    })
    .eq('id', input.ventaId)
    .neq('estado', 'cancelada')
    .select('id')

  if (error) return { error: error.message }
  if (!data || data.length === 0) {
    return { error: 'No se pudo registrar la factura: la venta no existe o está cancelada.' }
  }

  refrescar(input.ventaId)
  return { ok: true, mensaje: 'Factura registrada.' }
}

/**
 * Cancela la venta. `cancelar_venta` devuelve cada pieza a su lote de origen
 * y deja el movimiento en el kardex. Si la venta ya tiene pagos aplicados el
 * RPC la rechaza; ese mensaje se muestra tal cual.
 */
export async function cancelarVenta(input: {
  ventaId: string
  motivo: string
}): Promise<Resultado> {
  const motivo = input.motivo.trim()
  if (motivo.length < 4) {
    return { error: 'Escribe el motivo de la cancelación: queda asentado en el kardex.' }
  }

  const { error } = await supabase.rpc('cancelar_venta', {
    p_venta_id: input.ventaId,
    p_motivo: motivo,
    p_usuario: usuarioActual() ?? 'panel',
  })
  if (error) return { error: error.message }

  refrescar(input.ventaId)
  return { ok: true, mensaje: 'Venta cancelada. Las piezas regresaron a su lote.' }
}

/** Abono rápido contra la venta. El pago manual es la fuente de verdad (minuta 32). */
export async function registrarPago(input: {
  ventaId: string
  monto: string
  fecha: string
  metodo: string
  referencia: string
}): Promise<Resultado> {
  const monto = Number(input.monto)
  if (!Number.isFinite(monto) || monto <= 0) {
    return { error: 'El monto del pago debe ser mayor a cero.' }
  }

  const metodo = input.metodo as MetodoPago
  if (!METODOS.includes(metodo)) return { error: 'Elige el método de pago.' }

  const fecha = input.fecha.trim()
  if (!SOLO_FECHA.test(fecha)) return { error: 'La fecha del pago no es válida.' }

  const { data, error: errorVenta } = await supabase
    .from('ventas')
    .select('id, cliente_id, estado, total')
    .eq('id', input.ventaId)
    .maybeSingle()
  if (errorVenta) return { error: errorVenta.message }

  const venta: { cliente_id: string | null; estado: EstadoVenta; total: number } | null = data
  if (!venta) return { error: 'La venta ya no existe.' }
  if (venta.estado === 'cancelada') {
    return { error: 'La venta está cancelada: no admite pagos.' }
  }

  // El saldo se recalcula aquí y no se confía en el que traía la pantalla:
  // dos personas pueden estar cobrando la misma factura al mismo tiempo.
  const { data: previos, error: errorPagos } = await supabase
    .from('pagos')
    .select('monto')
    .eq('venta_id', input.ventaId)
  if (errorPagos) return { error: errorPagos.message }

  const pagado = ((previos ?? []) as { monto: number | null }[])
    .reduce((suma, p) => suma + Number(p.monto ?? 0), 0)
  const saldo = Number(venta.total ?? 0) - pagado

  if (saldo <= 0.005) return { error: 'Esta venta ya está pagada por completo.' }
  if (monto > saldo + 0.005) {
    return { error: `El monto excede el saldo pendiente (${pesos(saldo)}). Captura ese importe o menos.` }
  }

  const { error } = await supabase.from('pagos').insert({
    venta_id: input.ventaId,
    cliente_id: venta.cliente_id,
    monto,
    fecha,
    metodo,
    referencia: input.referencia.trim() || null,
    origen: 'manual',
    usuario: usuarioActual() ?? 'panel',
  })
  if (error) return { error: error.message }

  refrescar(input.ventaId)
  return {
    ok: true,
    mensaje: `Pago de ${pesos(monto)} registrado. Saldo restante: ${pesos(saldo - monto)}.`,
  }
}
