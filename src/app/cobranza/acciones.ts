'use server'

// Acciones de cobranza (minuta 30, 31, 32, 34, 35).
//
// Todo lo que cambia datos desde /cobranza pasa por aquí: aplicar un pago a
// una venta y ajustar las condiciones de crédito del cliente. La captura es
// manual y a propósito: el pago que registra el equipo es la fuente de
// verdad; el SAT y el banco sólo confirman después (minuta 32).

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { usuarioActual } from '@/lib/usuario'
import { pesos } from '@/lib/utils'
import type { MetodoPago, VentaCobranza } from '@/lib/types'

// Resultado de una acción. NO se exporta: un archivo 'use server' sólo debe
// exportar funciones async. El tipo igual llega al cliente por inferencia.
type Resultado = { ok: true; mensaje: string } | { ok: false; error: string }

type EntradaPago = {
  venta_id: string
  monto: number
  fecha: string                 // 'YYYY-MM-DD'
  metodo: MetodoPago
  referencia?: string
  notas?: string
  // El usuario ya vio el aviso de que se pasa del saldo y aun así confirmó.
  permitir_exceso?: boolean
}

// Tolerancia de centavo: la vista redondea a 2 decimales.
const CENTAVO = 0.01

const METODOS_VALIDOS: MetodoPago[] = [
  'efectivo', 'transferencia', 'tarjeta', 'cheque', 'compensacion',
]

// Sólo estos tres valores acepta el check de `clientes.factura_externa`.
const FACTURA_EXTERNA_VALIDA = ['contalink', 'aspel', 'otro']

/**
 * Aplica un pago a una venta. Se usa desde el tablero y desde el estado de
 * cuenta, siempre a través del client component `RegistrarPago`.
 */
export async function registrarPago(entrada: EntradaPago): Promise<Resultado> {
  if (!entrada?.venta_id) {
    return { ok: false, error: 'Elige la venta a la que se aplica el pago.' }
  }

  const monto = Number(entrada.monto)
  if (!Number.isFinite(monto) || monto <= 0) {
    return { ok: false, error: 'El monto del pago debe ser mayor a cero.' }
  }

  if (!entrada.fecha || !/^\d{4}-\d{2}-\d{2}$/.test(entrada.fecha)) {
    return { ok: false, error: 'La fecha del pago no es válida.' }
  }

  if (!METODOS_VALIDOS.includes(entrada.metodo)) {
    return { ok: false, error: 'El método de pago no es válido.' }
  }

  // El saldo se relee de la vista: es la fuente de verdad. Lo que traía la
  // pantalla pudo quedar viejo si alguien más aplicó otro pago mientras
  // tanto, y en cobranza eso pasa seguido.
  const { data, error: errVenta } = await supabase
    .from('v_ventas_cobranza')
    .select('venta_id, folio, cliente_id, estado, total, pagado, saldo')
    .eq('venta_id', entrada.venta_id)
    .maybeSingle()

  if (errVenta) return { ok: false, error: errVenta.message }

  const venta = data as Pick<
    VentaCobranza,
    'venta_id' | 'folio' | 'cliente_id' | 'estado' | 'total' | 'pagado' | 'saldo'
  > | null

  if (!venta) return { ok: false, error: 'La venta ya no existe.' }
  if (venta.estado === 'cancelada') {
    return { ok: false, error: 'La venta está cancelada: no admite pagos.' }
  }

  const saldo = Number(venta.saldo ?? 0)

  // Pago en exceso: se avisa claro y sólo pasa si el usuario lo confirma.
  if (monto > saldo + CENTAVO && !entrada.permitir_exceso) {
    return {
      ok: false,
      error:
        `El pago de ${pesos(monto)} se pasa del saldo de la venta ` +
        `${venta.folio ?? 'sin folio'}, que es de ${pesos(saldo)} ` +
        `(${pesos(monto - saldo)} de más). Si de verdad depositaron esa ` +
        'cantidad, confirma el pago en exceso para aplicarlo.',
    }
  }

  const { error } = await supabase.from('pagos').insert({
    venta_id: venta.venta_id,
    // El trigger `pagos_cliente` también lo deduce, pero mandarlo explícito
    // deja el renglón completo aunque el trigger se caiga en una migración.
    cliente_id: venta.cliente_id,
    monto,
    fecha: entrada.fecha,
    metodo: entrada.metodo,
    referencia: entrada.referencia?.trim() || null,
    notas: entrada.notas?.trim() || null,
    origen: 'manual',            // capturado a mano = fuente de verdad (minuta 32)
    usuario: usuarioActual(),
  })

  if (error) return { ok: false, error: error.message }

  revalidatePath('/cobranza')
  if (venta.cliente_id) revalidatePath(`/cobranza/${venta.cliente_id}`)

  const restante = saldo - monto
  const mensaje =
    restante > CENTAVO
      ? `Pago de ${pesos(monto)} aplicado. Queda un saldo de ${pesos(restante)}.`
      : restante < -CENTAVO
        ? `Pago de ${pesos(monto)} aplicado. Quedan ${pesos(-restante)} a favor del cliente.`
        : `Pago de ${pesos(monto)} aplicado. La venta queda saldada.`

  return { ok: true, mensaje }
}

/**
 * Condiciones de crédito del cliente (minuta 34 y 35): son los datos de los
 * que dependen el vencimiento de cada venta, las alertas y el portal que hay
 * que ir a revisar. Se edita desde el estado de cuenta con un <form>, por eso
 * recibe FormData y navega de vuelta con el resultado en la URL.
 */
export async function actualizarCredito(form: FormData): Promise<void> {
  const clienteId = String(form.get('cliente_id') ?? '').trim()
  if (!clienteId) redirect('/cobranza')

  const volverCon = (clave: 'ok' | 'err', valor: string) =>
    `/cobranza/${clienteId}?${clave}=${encodeURIComponent(valor)}`

  const diasRaw = String(form.get('dias_credito') ?? '').trim()
  const limiteRaw = String(form.get('limite_credito') ?? '').trim()
  const portal = String(form.get('portal_pagos_url') ?? '').trim()
  const facturaExterna = String(form.get('factura_externa') ?? '').trim()

  const dias = diasRaw === '' ? 0 : Number(diasRaw)
  if (!Number.isFinite(dias) || dias < 0 || dias > 365) {
    redirect(volverCon('err', 'Los días de crédito deben ir entre 0 y 365. 0 es contado.'))
  }

  const limite = limiteRaw === '' ? null : Number(limiteRaw)
  if (limite !== null && (!Number.isFinite(limite) || limite < 0)) {
    redirect(volverCon('err', 'El límite de crédito no es un monto válido.'))
  }

  if (portal && !/^https?:\/\//i.test(portal)) {
    redirect(volverCon('err', 'El portal de pagos debe empezar con http:// o https://'))
  }

  if (facturaExterna && !FACTURA_EXTERNA_VALIDA.includes(facturaExterna)) {
    redirect(volverCon('err', 'El sistema de facturación externa no es válido.'))
  }

  const { error } = await supabase
    .from('clientes')
    .update({
      dias_credito: Math.round(dias),
      limite_credito: limite,
      portal_pagos_url: portal || null,
      factura_externa: facturaExterna || null,
    })
    .eq('id', clienteId)

  if (error) redirect(volverCon('err', error.message))

  revalidatePath('/cobranza')
  revalidatePath(`/cobranza/${clienteId}`)
  redirect(volverCon('ok', 'Condiciones de crédito actualizadas.'))
}
