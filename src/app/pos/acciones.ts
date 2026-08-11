'use server'

// Server actions del punto de venta (minuta 7, 11, 16, 22, 23).
//
// Hoy las salidas se anotan en papel y la venta se captura en Aspel. Esta
// pantalla reemplaza las dos cosas: cada venta cerrada aquí descuenta el
// inventario de verdad, por lote y en la misma transacción
// (`pos_registrar_venta` -> `descontar_fefo` -> `registrar_movimiento`).
//
// Todo lo que toca Supabase vive aquí: el POSClient es un componente de
// cliente y no puede ver la service role key.

import { revalidatePath } from 'next/cache'
import { supabase } from '@/lib/supabase'
import { fijarUsuario, fijarSucursal } from '@/lib/usuario'
import { fechaEntregaEstimada, fechaISO, textoEntrega } from '@/lib/entrega'
import type { ProductoPOS, TipoCliente, FormaPago } from '@/lib/types'

// Los `numeric` de Postgres llegan como número o como cadena según el
// driver; se normalizan una sola vez para no arrastrar NaN al carrito.
function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function numONulo(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// ---------------------------------------------------------------------
//  1 · Búsqueda del mostrador: un solo campo para pistola y para teclado
// ---------------------------------------------------------------------

/**
 * Busca en el catálogo de la plaza activa. El RPC acepta nombre O código de
 * barras en el mismo campo (minuta 22) y le da score 2.00 al código exacto,
 * que es la señal de que vino de la pistola.
 */
export async function buscarProductosPOS(
  q: string,
  sucursalId: string,
): Promise<{ productos: ProductoPOS[]; error?: string }> {
  const texto = q.trim()
  // El RPC ya exige 2 caracteres salvo que sea código exacto; no vale la
  // pena el viaje al servidor por una sola letra.
  if (texto.length < 2) return { productos: [] }

  const { data, error } = await supabase.rpc('buscar_productos_pos', {
    q: texto,
    p_sucursal: sucursalId,
    limite: 10,
  })

  if (error) return { productos: [], error: error.message }

  const filas = (data ?? []) as ProductoPOS[]
  return {
    productos: filas.map(p => ({
      ...p,
      precio_base: numONulo(p.precio_base),
      tasa_iva: num(p.tasa_iva),
      existencia: num(p.existencia),
      existencia_otras: num(p.existencia_otras),
      score: num(p.score),
      controlado: p.controlado === true,
      lotes: Array.isArray(p.lotes) ? p.lotes : [],
    })),
  }
}

// ---------------------------------------------------------------------
//  2 · Cliente de la venta (o mostrador, sin cliente)
// ---------------------------------------------------------------------

interface ClienteFila {
  id: string
  nombre: string | null
  empresa: string | null
  tipo: TipoCliente | null
  ciudad: string | null
  dias_credito: number | null
  limite_credito: number | null
  requiere_factura: boolean | null
}

/** Buscador simple por nombre o empresa. La venta también puede ir sin cliente. */
export async function buscarClientesPOS(
  q: string,
): Promise<{ clientes: ClienteFila[]; error?: string }> {
  // Las comas y los paréntesis rompen la sintaxis de `.or()` de PostgREST.
  const texto = q.trim().replace(/[,()%*]/g, ' ').trim()
  if (texto.length < 2) return { clientes: [] }

  const patron = `%${texto}%`
  const { data, error } = await supabase
    .from('clientes')
    .select('id, nombre, empresa, tipo, ciudad, dias_credito, limite_credito, requiere_factura')
    .or(`nombre.ilike.${patron},empresa.ilike.${patron}`)
    .order('nombre')
    .limit(8)

  if (error) return { clientes: [], error: error.message }

  const filas = (data ?? []) as ClienteFila[]
  return {
    clientes: filas.map(c => ({
      ...c,
      dias_credito: numONulo(c.dias_credito),
      limite_credito: numONulo(c.limite_credito),
    })),
  }
}

// ---------------------------------------------------------------------
//  3 · Cerrar la venta
// ---------------------------------------------------------------------

interface ItemEntrada {
  producto_id: string
  descripcion: string
  cantidad: number
  precio_unitario: number
  // Porcentaje 0-100: el RPC hace `1 - descuento_pct / 100`.
  descuento_pct: number
}

interface EntradaVenta {
  sucursal_id: string
  cliente_id: string | null
  usuario: string | null
  forma_pago: FormaPago
  dias_credito: number
  requiere_factura: boolean
  notas: string | null
  items: ItemEntrada[]
}

// Un lote del que se surtió una partida, tal como lo deja `descontar_fefo`
// en `venta_items.lotes`.
interface LoteCrudo {
  lote?: string | null
  caducidad?: string | null
  ubicacion?: string | null
  cantidad?: number | string | null
  costo?: number | string | null
}

interface FilaItemVenta {
  descripcion: string | null
  cantidad: number | string | null
  precio_unitario: number | string | null
  descuento_pct: number | string | null
  tasa_iva: number | string | null
  subtotal: number | string | null
  iva: number | string | null
  total: number | string | null
  lotes: LoteCrudo[] | null
  posicion: number | null
}

interface RespuestaRPC {
  venta_id?: string
  folio?: string | null
  subtotal?: number | string
  iva?: number | string
  total?: number | string
}

/**
 * Registra la venta con `pos_registrar_venta`. El RPC calcula el IVA con la
 * tasa de cada producto (minuta 3), descuenta FEFO y deja el kardex; si algo
 * falla no queda nada a medias.
 *
 * La fecha de entrega se compromete aquí, no en el render: si la caja lleva
 * la pantalla abierta desde ayer, la fecha sigue siendo la correcta
 * (minuta 5 y 6).
 */
export async function cerrarVentaPOS(entrada: EntradaVenta) {
  if (!entrada.sucursal_id) {
    return { ok: false as const, error: 'Falta la plaza: el inventario es por plaza.' }
  }
  if (!entrada.items.length) {
    return { ok: false as const, error: 'La venta no tiene partidas.' }
  }
  if (entrada.items.some(i => !i.producto_id || !(i.cantidad > 0))) {
    return { ok: false as const, error: 'Hay una partida sin producto o con cantidad en cero.' }
  }

  const entregaEl = fechaEntregaEstimada()

  const p = {
    sucursal_id: entrada.sucursal_id,
    cliente_id: entrada.cliente_id,
    usuario: entrada.usuario,
    forma_pago: entrada.forma_pago,
    dias_credito: entrada.forma_pago === 'credito' ? entrada.dias_credito : 0,
    requiere_factura: entrada.requiere_factura,
    canal: 'pos',
    notas: entrada.notas,
    fecha_entrega: fechaISO(entregaEl),
    solicitud_id: null,
    cotizacion_id: null,
    items: entrada.items.map(i => ({
      producto_id: i.producto_id,
      cantidad: i.cantidad,
      precio_unitario: i.precio_unitario,
      descuento_pct: i.descuento_pct,
      descripcion: i.descripcion,
    })),
  }

  const { data, error } = await supabase.rpc('pos_registrar_venta', { p })

  // Los `raise exception` de Postgres vienen en español y son legibles para
  // el mostrador ("Existencia insuficiente: hay 3 y se intentan sacar 5.").
  if (error) return { ok: false as const, error: error.message }

  const r = (data ?? null) as RespuestaRPC | null
  if (!r?.venta_id) {
    return { ok: false as const, error: 'El servidor no devolvió la venta registrada.' }
  }

  // De qué lote salió cada producto: se relee `venta_items`, que es donde
  // `descontar_fefo` dejó el detalle (minuta 23).
  const { data: itemsData } = await supabase
    .from('venta_items')
    .select('descripcion, cantidad, precio_unitario, descuento_pct, tasa_iva, subtotal, iva, total, lotes, posicion')
    .eq('venta_id', r.venta_id)
    .order('posicion')

  const items = ((itemsData ?? []) as FilaItemVenta[]).map(it => ({
    descripcion: it.descripcion ?? '—',
    cantidad: num(it.cantidad),
    precio_unitario: num(it.precio_unitario),
    tasa_iva: num(it.tasa_iva),
    subtotal: num(it.subtotal),
    iva: num(it.iva),
    total: num(it.total),
    lotes: (Array.isArray(it.lotes) ? it.lotes : []).map(l => ({
      lote: l.lote ?? null,
      caducidad: l.caducidad ?? null,
      ubicacion: l.ubicacion ?? null,
      cantidad: num(l.cantidad),
    })),
  }))

  // El inventario y la cobranza cambiaron con esta venta.
  revalidatePath('/inventario')
  revalidatePath('/ventas')
  revalidatePath('/pos')

  return {
    ok: true as const,
    venta_id: r.venta_id,
    folio: r.folio ?? null,
    subtotal: num(r.subtotal),
    iva: num(r.iva),
    total: num(r.total),
    fecha_entrega: fechaISO(entregaEl),
    // La frase que se le dice al cliente, la misma que manda el bot.
    texto_entrega: textoEntrega(),
    items,
  }
}

// ---------------------------------------------------------------------
//  4 · Quién cobra y en qué plaza (minuta 8, 28)
// ---------------------------------------------------------------------

/** Guarda en cookie a quién le toca la caja; firma cada movimiento del kardex. */
export async function fijarCajero(nombre: string) {
  fijarUsuario(nombre)
  revalidatePath('/', 'layout')
  return { ok: true as const }
}

/** Cambia la plaza activa. El inventario es por plaza, no hay uno solo. */
export async function fijarPlaza(sucursalId: string) {
  fijarSucursal(sucursalId)
  revalidatePath('/', 'layout')
  return { ok: true as const }
}
