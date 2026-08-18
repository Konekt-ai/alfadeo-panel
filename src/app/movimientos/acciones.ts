'use server'

// Alta rápida de movimientos de inventario (minuta 8, 10, 23).
//
// Sustituye la libreta de papel donde hoy anotan entradas y salidas. Todo
// pasa por los RPC: `registrar_movimiento` bloquea el lote y deja asiento en
// el kardex, y `descontar_fefo` reparte una salida entre lotes cuando el
// operador no quiere elegir cuál.
//
// Los `raise exception` de Postgres ya vienen redactados en español
// ("Existencia insuficiente: hay 3 y se intentan sacar 5."), así que el
// mensaje se devuelve tal cual y la pantalla lo pinta sin tocarlo.

import { revalidatePath } from 'next/cache'
import { sql, qx, uno } from '@/lib/db'
import { usuarioActual, fijarUsuario } from '@/lib/usuario'
import { movimientoLabel } from '@/lib/utils'
import type { ProductoPOS } from '@/lib/types'

/** Los tres que se capturan a mano. Los demás los generan venta, traslado y compra. */
export type TipoManual = 'entrada' | 'salida' | 'ajuste'

/** Una fila de `inventario`: en este esquema, una fila ES un lote. */
export interface LoteDisponible {
  inventario_id: string
  lote: string | null
  caducidad: string | null
  ubicacion: string | null
  existencia: number
  costo_unitario: number | null
}

export interface MovimientoManual {
  tipo: TipoManual
  producto_id: string
  producto_nombre: string
  sucursal_id: string
  /** Siempre positiva. En 'ajuste' es la existencia REAL contada en el anaquel. */
  cantidad: number
  /** Fila de inventario elegida. null cuando es lote nuevo o salida FEFO. */
  inventario_id: string | null
  lote: string | null
  caducidad: string | null
  ubicacion: string | null
  costo_unitario: number | null
  motivo: string | null
  /** Salida sin lote concreto: sale primero lo que caduca antes. */
  fefo: boolean
}

export interface Resultado {
  ok?: boolean
  /** Confirmación de lo que quedó guardado. */
  mensaje?: string
  /** No se hizo nada, pero tampoco es un error (ajuste sin diferencia). */
  aviso?: string
  /** Texto del RPC, tal cual lo manda Postgres. */
  error?: string
}

// Las existencias son numeric(14,3): se redondea a 3 para que la resta de
// dos flotantes no invente diferencias de 0.0000001.
const tresDecimales = (n: number) => Math.round(n * 1000) / 1000

const piezas = (n: number) =>
  Number.isInteger(n) ? String(n) : String(tresDecimales(n))

/**
 * Buscador del alta rápida. Acepta nombre o código de barras en el mismo
 * campo (minuta 22) y trae los lotes de la plaza en orden FEFO.
 */
export async function buscarProductos(
  q: string,
  sucursalId: string,
): Promise<{ productos: ProductoPOS[]; error?: string }> {
  const texto = q.trim()
  if (texto.length < 2) return { productos: [] }

  const { data, error } = await sql<ProductoPOS>(
    `select * from buscar_productos_pos($1, $2::uuid, $3)`,
    [texto, sucursalId || null, 12]
  )

  if (error) return { productos: [], error: error.message }
  return { productos: data }
}

/**
 * Lotes con existencia de un producto en una plaza (minuta 23: hay que poder
 * decir de QUÉ lote entra o sale). Se lee directo de `inventario` porque hace
 * falta el id de la fila para apuntar el movimiento sin ambigüedad.
 */
export async function lotesDeProducto(
  productoId: string,
  sucursalId: string,
): Promise<{ lotes: LoteDisponible[]; error?: string }> {
  if (!productoId || !sucursalId) return { lotes: [] }

  // Orden FEFO: el que caduca antes primero, y los sin caducidad al final.
  const { data: filas, error } = await sql<{
    id: string
    lote: string | null
    caducidad: string | null
    ubicacion: string | null
    existencia: number | null
    costo_unitario: number | null
  }>(
    `select id, lote, caducidad, ubicacion, existencia, costo_unitario
       from inventario
      where producto_id = $1::uuid
        and sucursal_id = $2::uuid
        and existencia > 0
      order by caducidad asc nulls last`,
    [productoId, sucursalId]
  )

  if (error) return { lotes: [], error: error.message }

  const lotes: LoteDisponible[] = filas.map(fila => ({
    inventario_id: String(fila.id),
    lote: fila.lote ?? null,
    caducidad: fila.caducidad ?? null,
    ubicacion: fila.ubicacion ?? null,
    existencia: Number(fila.existencia ?? 0),
    costo_unitario: fila.costo_unitario == null ? null : Number(fila.costo_unitario),
  }))

  return { lotes }
}

/**
 * Registra el movimiento. La cantidad se firma AQUÍ, en el servidor: positiva
 * en entrada, negativa en salida, diferencia en ajuste. Y la firma de quién
 * lo hizo sale de la cookie, no de lo que mande el navegador.
 */
export async function registrarMovimiento(m: MovimientoManual): Promise<Resultado> {
  const usuario = usuarioActual()
  if (!usuario) {
    return { error: 'Antes de mover inventario hay que decir quién lo hace. Elige tu nombre y vuelve a intentar.' }
  }
  if (!m.producto_id) return { error: 'Elige el producto que se está moviendo.' }
  if (!m.sucursal_id) return { error: 'Elige la plaza: el inventario es por plaza.' }

  const cantidad = Number(m.cantidad)
  if (!Number.isFinite(cantidad) || cantidad < 0) {
    return { error: 'La cantidad no es un número válido.' }
  }
  if (m.tipo !== 'ajuste' && cantidad <= 0) {
    return { error: 'La cantidad tiene que ser mayor que cero.' }
  }

  const motivo = m.motivo?.trim() || null
  const costo = m.costo_unitario == null || !Number.isFinite(Number(m.costo_unitario))
    ? null
    : Number(m.costo_unitario)

  // ---- Salida sin lote concreto: el que caduca primero ------------------
  if (m.tipo === 'salida' && m.fefo) {
    // Notación con nombre: son ocho parámetros y posicionalmente sería
    // imposible de leer.
    let usados: Array<{ lote: string | null; cantidad: number }> = []
    try {
      const filas = await qx<{ r: Array<{ lote: string | null; cantidad: number }> }>(
        `select descontar_fefo(
                  p_producto_id     => $1::uuid,
                  p_sucursal_id     => $2::uuid,
                  p_cantidad        => $3,
                  p_tipo            => 'salida',
                  p_motivo          => $4,
                  p_referencia_tipo => 'manual',
                  p_usuario         => $5) as r`,
        [m.producto_id, m.sucursal_id, tresDecimales(cantidad), motivo, usuario]
      )
      usados = filas[0]?.r ?? []
    } catch (e) {
      return { error: (e as Error).message }
    }
    const detalle = usados
      .map(l => `${l.lote || 'sin lote'} (${piezas(Number(l.cantidad ?? 0))})`)
      .join(', ')

    revalidatePath('/movimientos')
    revalidatePath('/inventario')
    return {
      ok: true,
      mensaje: `Salida de ${piezas(cantidad)} pza de ${m.producto_nombre}` +
        (detalle ? ` · tomadas del lote ${detalle}.` : '.'),
    }
  }

  // ---- Cantidad con signo ----------------------------------------------
  let cantidadFirmada = 0

  if (m.tipo === 'entrada') {
    cantidadFirmada = tresDecimales(cantidad)
  } else if (m.tipo === 'salida') {
    cantidadFirmada = -tresDecimales(cantidad)
  } else {
    // Ajuste: el operador captura lo que CONTÓ y aquí se manda la diferencia.
    // La existencia del sistema se relee ahora mismo, no se confía en la que
    // vio el navegador hace un minuto.
    let enSistema = 0
    if (m.inventario_id) {
      const { data: fila, error } = await uno<{ existencia: number | null }>(
        `select existencia from inventario where id = $1::uuid`,
        [m.inventario_id]
      )
      if (error) return { error: error.message }
      enSistema = Number(fila?.existencia ?? 0)
    }

    cantidadFirmada = tresDecimales(cantidad - enSistema)

    if (cantidadFirmada === 0) {
      return {
        aviso: `No hay nada que ajustar: el sistema ya tiene ${piezas(enSistema)} pza y contaste ${piezas(cantidad)}.`,
      }
    }
  }

  try {
    await qx(
      `select registrar_movimiento(
                p_producto_id     => $1::uuid,
                p_sucursal_id     => $2::uuid,
                p_cantidad        => $3,
                p_tipo            => $4,
                p_lote            => $5,
                p_ubicacion       => $6,
                p_caducidad       => $7::date,
                p_costo_unitario  => $8,
                p_motivo          => $9,
                p_referencia_tipo => 'manual',
                p_usuario         => $10,
                p_inventario_id   => $11::uuid)`,
      [
        m.producto_id,
        m.sucursal_id,
        cantidadFirmada,
        m.tipo,
        m.lote?.trim() || null,
        m.ubicacion?.trim() || null,
        m.caducidad || null,
        // El costo sólo tiene sentido cuando entra mercancía.
        cantidadFirmada > 0 ? costo : null,
        motivo,
        usuario,
        m.inventario_id || null,
      ]
    )
  } catch (e) {
    return { error: (e as Error).message }
  }

  revalidatePath('/movimientos')
  revalidatePath('/inventario')

  const signo = cantidadFirmada > 0 ? '+' : '−'
  return {
    ok: true,
    mensaje: `Listo: ${movimientoLabel(m.tipo)} de ${signo}${piezas(Math.abs(cantidadFirmada))} pza · ${m.producto_nombre}` +
      (m.lote ? ` · lote ${m.lote}.` : '.'),
  }
}

/**
 * Quién opera (minuta 8). No es login: es la firma que viaja en cada
 * movimiento del kardex, para poder reclamar un faltante.
 */
export async function elegirUsuario(nombre: string): Promise<Resultado> {
  const limpio = nombre.trim()
  if (!limpio) return { error: 'Elige tu nombre de la lista.' }

  fijarUsuario(limpio)
  revalidatePath('/', 'layout')
  return { ok: true }
}
