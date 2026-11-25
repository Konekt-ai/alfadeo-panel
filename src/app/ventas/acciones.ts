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
import { qx, uno } from '@/lib/db'
import { usuarioActual } from '@/lib/usuario'
import { pesos } from '@/lib/utils'
import { parsearCFDI } from '../compras/cfdi'
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

  const duplicada = await facturaYaLigada(uuid, input.ventaId)
  if (duplicada) return { error: duplicada }

  // `returning id` cumple la misma función que el `.select()` de antes:
  // distinguir "no existe / está cancelada" de "sí se actualizó".
  let data: Array<{ id: string }>
  try {
    data = await qx<{ id: string }>(
      `update ventas
          set factura_emisor   = $1,
              factura_serie    = $2,
              factura_folio    = $3,
              factura_uuid     = $4,
              requiere_factura = true,
              facturado_en     = now(),
              updated_at       = now()
        where id = $5::uuid
          and estado <> 'cancelada'
        returning id`,
      [emisor, input.serie.trim() || null, input.folio.trim() || null, uuid, input.ventaId]
    )
  } catch (e) {
    return { error: (e as Error).message }
  }

  if (data.length === 0) {
    return { error: 'No se pudo registrar la factura: la venta no existe o está cancelada.' }
  }

  refrescar(input.ventaId)
  return { ok: true, mensaje: 'Factura registrada.' }
}

/**
 * Una factura es una sola venta. Si el UUID ya está en otra venta, o es el
 * de una factura de proveedor capturada en Compras, se dice dónde está en
 * vez de ligarla dos veces. Devuelve el mensaje, o null si está libre.
 */
async function facturaYaLigada(uuid: string, ventaId: string): Promise<string | null> {
  const { data } = await uno<{ donde: string; folio: string | null }>(
    `select 'venta' as donde, folio from ventas
      where lower(factura_uuid::text) = lower($1) and id <> $2::uuid
     union all
     select 'compra', folio from compras
      where lower(factura_uuid::text) = lower($1)
     limit 1`,
    [uuid, ventaId]
  )
  if (!data) return null
  return data.donde === 'venta'
    ? `Esa factura ya está ligada a la venta ${data.folio ?? 'sin folio'}. Una factura no se liga dos veces.`
    : `Ese UUID es de una factura de proveedor, capturada en la compra ${data.folio ?? 'sin folio'}.`
}

/**
 * Liga la factura a partir del XML timbrado (el que entrega FACTURE o
 * cualquier otro sistema). Del XML salen serie, folio, UUID y fecha: nadie
 * los copia a mano.
 *
 * Antes de ligarla se revisa que sea de ESTA venta: que el RFC del receptor
 * sea el del cliente y que el total cuadre. Si el total no cuadra (una
 * factura que agrupa varias ventas, un ajuste de centavos) se avisa, y con
 * `aunqueNoCuadre` la persona confirma y se liga igual. El RFC no se puede
 * forzar: si es de otro cliente, es otra factura.
 */
export async function ligarFacturaXML(input: {
  ventaId: string
  emisor: string
  xml: string
  aunqueNoCuadre?: boolean
}): Promise<Resultado | { revisar: string }> {
  const emisor = input.emisor as FacturaEmisor
  if (!EMISORES.includes(emisor)) {
    return { error: 'Indica quién timbró la factura.' }
  }

  let cfdi
  try {
    cfdi = parsearCFDI(input.xml)
  } catch (e) {
    return { error: (e as Error).message }
  }
  if (!cfdi.uuid || !UUID_CFDI.test(cfdi.uuid)) {
    return { error: 'El XML no trae timbre fiscal: es una factura sin timbrar o un borrador. Sube el XML ya timbrado.' }
  }

  const { data: venta, error } = await uno<{
    folio: string | null
    estado: EstadoVenta
    total: number
    cliente_rfc: string | null
    cliente: string | null
  }>(
    `select v.folio, v.estado, v.total, c.rfc as cliente_rfc,
            coalesce(c.razon_social, c.empresa, c.nombre) as cliente
       from ventas v
       left join clientes c on c.id = v.cliente_id
      where v.id = $1::uuid`,
    [input.ventaId]
  )
  if (error) return { error: error.message }
  if (!venta) return { error: 'Esa venta ya no existe.' }
  if (venta.estado === 'cancelada') return { error: 'La venta está cancelada: no se le liga factura.' }

  const duplicada = await facturaYaLigada(cfdi.uuid, input.ventaId)
  if (duplicada) return { error: duplicada }

  // RFC genérico de público en general: es válido para cualquier venta.
  const rfcXml = (cfdi.receptor_rfc ?? '').toUpperCase()
  const rfcCliente = (venta.cliente_rfc ?? '').trim().toUpperCase()
  if (rfcCliente && rfcXml && rfcXml !== rfcCliente && rfcXml !== 'XAXX010101000') {
    return {
      error: `La factura está a nombre de ${cfdi.receptor_nombre ?? rfcXml} (RFC ${rfcXml}), ` +
        `pero el cliente de la venta tiene RFC ${rfcCliente}. Revisa que sea la factura correcta.`,
    }
  }

  const diferencia = Math.abs(Number(cfdi.total) - Number(venta.total))
  if (diferencia > 1 && !input.aunqueNoCuadre) {
    return {
      revisar: `El total de la factura (${pesos(cfdi.total)}) no es el de la venta (${pesos(Number(venta.total))}). ` +
        '¿Es la factura correcta?',
    }
  }

  try {
    await qx(
      `update ventas
          set factura_emisor   = $1,
              factura_serie    = $2,
              factura_folio    = $3,
              factura_uuid     = $4,
              requiere_factura = true,
              -- La Fecha del CFDI viene sin zona, en la hora local de
              -- donde se expidió: Guadalajara o Monterrey, misma zona que CDMX.
              facturado_en     = coalesce($5::timestamp at time zone 'America/Mexico_City', now()),
              updated_at       = now()
        where id = $6::uuid`,
      [emisor, cfdi.serie, cfdi.folio, cfdi.uuid, cfdi.fecha, input.ventaId]
    )
  } catch (e) {
    return { error: (e as Error).message }
  }

  refrescar(input.ventaId)
  const folio = [cfdi.serie, cfdi.folio].filter(Boolean).join('-')
  return { ok: true, mensaje: `Factura ${folio || cfdi.uuid} ligada a la venta.` }
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

  // Si la venta tiene pagos aplicados, la función lo rechaza con un mensaje
  // en español; se deja pasar tal cual.
  try {
    await qx(
      `select cancelar_venta($1::uuid, $2, $3)`,
      [input.ventaId, motivo, usuarioActual() ?? 'panel']
    )
  } catch (e) {
    return { error: (e as Error).message }
  }

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

  const { data: venta, error: errorVenta } = await uno<{
    cliente_id: string | null; estado: EstadoVenta; total: number
  }>(
    `select cliente_id, estado, total from ventas where id = $1::uuid`,
    [input.ventaId]
  )
  if (errorVenta) return { error: errorVenta.message }
  if (!venta) return { error: 'La venta ya no existe.' }
  if (venta.estado === 'cancelada') {
    return { error: 'La venta está cancelada: no admite pagos.' }
  }

  // El saldo se recalcula aquí y no se confía en el que traía la pantalla:
  // dos personas pueden estar cobrando la misma factura al mismo tiempo.
  // La suma la hace Postgres: es una fila en vez de traerlas todas.
  const { data: acum, error: errorPagos } = await uno<{ pagado: number }>(
    `select coalesce(sum(monto), 0) as pagado from pagos where venta_id = $1::uuid`,
    [input.ventaId]
  )
  if (errorPagos) return { error: errorPagos.message }

  const pagado = Number(acum?.pagado ?? 0)
  const saldo = Number(venta.total ?? 0) - pagado

  if (saldo <= 0.005) return { error: 'Esta venta ya está pagada por completo.' }
  if (monto > saldo + 0.005) {
    return { error: `El monto excede el saldo pendiente (${pesos(saldo)}). Captura ese importe o menos.` }
  }

  try {
    await qx(
      `insert into pagos (venta_id, cliente_id, monto, fecha, metodo,
                          referencia, origen, usuario)
       values ($1::uuid, $2::uuid, $3, $4::date, $5, $6, 'manual', $7)`,
      [
        input.ventaId,
        venta.cliente_id,
        monto,
        fecha,
        metodo,
        input.referencia.trim() || null,
        usuarioActual() ?? 'panel',
      ]
    )
  } catch (e) {
    return { error: (e as Error).message }
  }

  refrescar(input.ventaId)
  return {
    ok: true,
    mensaje: `Pago de ${pesos(monto)} registrado. Saldo restante: ${pesos(saldo - monto)}.`,
  }
}
