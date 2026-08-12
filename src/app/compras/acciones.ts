'use server'

// Compras: captura al recibir mercancía (minuta 26) y lectura del CFDI del
// proveedor (minuta 29).
//
// La entrada al almacén NO se hace aquí: se hace en `recibir_compra`, que
// llama a `registrar_movimiento` por cada partida y crea los lotes que no
// existían. Así una compra capturada pero no recibida no infla el inventario.

import { revalidatePath } from 'next/cache'
import { supabase } from '@/lib/supabase'
import { usuarioActual } from '@/lib/usuario'
import type { ProductoPOS } from '@/lib/types'
import { parsearCFDI, type CfdiConcepto } from './cfdi'

type Resultado = { ok: true } | { ok: false; error: string }
type ResultadoCon<T> = { ok: true; data: T } | { ok: false; error: string }

const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// ---------------------------------------------------------------------
//  1 · Buscador de productos para ligar partidas
// ---------------------------------------------------------------------

export async function buscarProductoCompra(q: string, sucursalId: string) {
  const texto = q.trim()
  if (texto.length < 2) return { productos: [] as ProductoPOS[] }

  const { data, error } = await supabase.rpc('buscar_productos_pos', {
    q: texto, p_sucursal: sucursalId, limite: 8,
  })
  if (error) return { productos: [] as ProductoPOS[], error: error.message }
  return { productos: (data ?? []) as ProductoPOS[] }
}

// ---------------------------------------------------------------------
//  2 · Lector de facturas
// ---------------------------------------------------------------------

export interface PartidaPrecargada {
  descripcion: string
  clave_prov: string | null
  codigo_barras: string | null
  cantidad: number
  costo_unitario: number
  tasa_iva: number
  // Resultado del match contra el catálogo.
  producto_id: string | null
  producto_nombre: string | null
  // 'codigo' es match duro; 'nombre' hay que revisarlo; 'ninguno' bloquea la
  // recepción hasta que alguien lo ligue a mano.
  match: 'codigo' | 'nombre' | 'ninguno'
}

/**
 * Lee el XML del CFDI y devuelve la compra ya precargada, con cada renglón
 * intentando amarrarse a un producto del catálogo.
 *
 * El match por código de barras es el bueno: `NoIdentificacion` del CFDI
 * suele traer el EAN, que es justo el dato que hace falta para el POS
 * (minuta 22). El match por nombre es una sugerencia y se marca como tal.
 */
export async function leerCFDI(xml: string, sucursalId: string) {
  let cfdi
  try {
    cfdi = parsearCFDI(xml)
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : 'No se pudo leer el XML.' }
  }

  // Si esta factura ya se capturó, no tiene caso volver a hacerlo.
  if (cfdi.uuid) {
    const { data: previa } = await supabase
      .from('compras').select('id, folio').eq('factura_uuid', cfdi.uuid).maybeSingle()
    if (previa) {
      return {
        ok: false as const,
        error: `Esta factura ya está capturada en la compra ${previa.folio ?? previa.id}.`,
      }
    }
  }

  const partidas: PartidaPrecargada[] = []
  for (const c of cfdi.conceptos) {
    partidas.push(await ligarConcepto(c, sucursalId))
  }

  return {
    ok: true as const,
    cfdi: {
      serie: cfdi.serie,
      folio: cfdi.folio,
      fecha: cfdi.fecha_dia,
      uuid: cfdi.uuid,
      emisor_rfc: cfdi.emisor_rfc,
      emisor_nombre: cfdi.emisor_nombre,
      subtotal: cfdi.subtotal,
      total: cfdi.total,
      moneda: cfdi.moneda,
    },
    partidas,
  }
}

async function ligarConcepto(c: CfdiConcepto, sucursalId: string): Promise<PartidaPrecargada> {
  const base: PartidaPrecargada = {
    descripcion: c.descripcion,
    clave_prov: c.no_identificacion,
    codigo_barras: null,
    cantidad: c.cantidad,
    costo_unitario: c.valor_unitario,
    tasa_iva: c.tasa_iva,
    producto_id: null,
    producto_nombre: null,
    match: 'ninguno',
  }

  // (a) Por código de barras exacto. Sólo se toma como código si parece uno:
  //     hay proveedores que meten su SKU interno en NoIdentificacion.
  const clave = (c.no_identificacion ?? '').trim()
  if (/^\d{8,14}$/.test(clave)) {
    base.codigo_barras = clave
    const { data } = await supabase
      .from('productos')
      .select('id, nombre, nombre_comercial')
      .eq('codigo_barras', clave)
      .limit(1)
    const p = data?.[0]
    if (p) {
      return { ...base, producto_id: p.id, producto_nombre: p.nombre_comercial ?? p.nombre, match: 'codigo' }
    }
  }

  // (b) Por nombre. Sólo se propone si el score es alto; por debajo de eso
  //     es peor sugerir mal que no sugerir.
  const { data } = await supabase.rpc('buscar_productos_pos', {
    q: c.descripcion, p_sucursal: sucursalId, limite: 1,
  })
  const sugerido = ((data ?? []) as ProductoPOS[])[0]
  if (sugerido && num(sugerido.score) >= 0.55) {
    return {
      ...base,
      producto_id: sugerido.producto_id,
      producto_nombre: sugerido.nombre_comercial ?? sugerido.nombre,
      match: 'nombre',
    }
  }

  return base
}

// ---------------------------------------------------------------------
//  3 · Guardar la compra
// ---------------------------------------------------------------------

export interface PartidaEntrada {
  producto_id: string | null
  descripcion: string
  clave_prov: string | null
  codigo_barras: string | null
  cantidad: number
  costo_unitario: number
  tasa_iva: number
  lote: string | null
  caducidad: string | null
  ubicacion: string | null
}

export interface CompraEntrada {
  proveedor_id: string | null
  sucursal_id: string
  fecha: string
  factura_serie: string | null
  factura_folio: string | null
  factura_uuid: string | null
  emisor_rfc: string | null
  emisor_nombre: string | null
  moneda: string
  notas: string | null
  xml_origen: string | null
  partidas: PartidaEntrada[]
  // Si viene en true, se intenta recibir en el mismo paso.
  recibir: boolean
}

export async function crearCompra(entrada: CompraEntrada): Promise<ResultadoCon<{ id: string; recibida: boolean }>> {
  if (!entrada.sucursal_id) {
    return { ok: false, error: 'Falta la plaza a la que entra la mercancía.' }
  }
  if (!entrada.partidas.length) {
    return { ok: false, error: 'La compra no tiene partidas.' }
  }
  if (entrada.partidas.some(p => !(p.cantidad > 0))) {
    return { ok: false, error: 'Hay una partida con cantidad en cero.' }
  }
  if (entrada.recibir && entrada.partidas.some(p => !p.producto_id)) {
    return { ok: false, error: 'Para recibir la mercancía, todas las partidas tienen que estar ligadas a un producto del catálogo.' }
  }

  const { data: folio, error: errorFolio } = await supabase.rpc('siguiente_folio', {
    p_ambito: 'compra', p_sucursal_id: entrada.sucursal_id,
  })
  if (errorFolio) return { ok: false, error: errorFolio.message }

  // Los totales se calculan aquí y no se confía en los del CFDI: las partidas
  // pudieron editarse en pantalla antes de guardar.
  let subtotal = 0
  let iva = 0
  for (const p of entrada.partidas) {
    const base = Math.round(p.cantidad * p.costo_unitario * 100) / 100
    subtotal += base
    iva += Math.round(base * p.tasa_iva * 100) / 100
  }
  subtotal = Math.round(subtotal * 100) / 100
  iva = Math.round(iva * 100) / 100

  const { data: compra, error } = await supabase
    .from('compras')
    .insert({
      folio,
      proveedor_id: entrada.proveedor_id,
      sucursal_id: entrada.sucursal_id,
      fecha: entrada.fecha,
      estado: 'borrador',
      subtotal, iva, total: Math.round((subtotal + iva) * 100) / 100,
      moneda: entrada.moneda || 'MXN',
      factura_serie: entrada.factura_serie,
      factura_folio: entrada.factura_folio,
      factura_uuid: entrada.factura_uuid,
      emisor_rfc: entrada.emisor_rfc,
      emisor_nombre: entrada.emisor_nombre,
      xml_origen: entrada.xml_origen,
      usuario: usuarioActual(),
      notas: entrada.notas,
    })
    .select('id')
    .single()

  if (error) return { ok: false, error: error.message }

  const { error: errorItems } = await supabase.from('compra_items').insert(
    entrada.partidas.map((p, i) => ({
      compra_id: compra.id,
      producto_id: p.producto_id,
      descripcion: p.descripcion,
      clave_prov: p.clave_prov,
      codigo_barras: p.codigo_barras,
      cantidad: p.cantidad,
      costo_unitario: p.costo_unitario,
      tasa_iva: p.tasa_iva,
      lote: p.lote,
      caducidad: p.caducidad,
      ubicacion: p.ubicacion,
      posicion: i + 1,
    }))
  )

  if (errorItems) {
    // La compra sin partidas no sirve para nada; se retira para no dejar
    // basura ni quemar el folio en un documento vacío.
    await supabase.from('compras').delete().eq('id', compra.id)
    return { ok: false, error: errorItems.message }
  }

  let recibida = false
  if (entrada.recibir) {
    const r = await supabase.rpc('recibir_compra', {
      p_compra_id: compra.id, p_usuario: usuarioActual(),
    })
    if (r.error) {
      // La compra queda guardada en borrador: se puede recibir después sin
      // recapturarla. Se avisa qué falló.
      revalidatePath('/compras')
      return { ok: false, error: `La compra se guardó como borrador, pero no se pudo recibir: ${r.error.message}` }
    }
    recibida = true
  }

  revalidatePath('/compras')
  revalidatePath('/inventario')
  return { ok: true, data: { id: compra.id, recibida } }
}

// ---------------------------------------------------------------------
//  4 · Recibir la mercancía (es lo que la mete al almacén)
// ---------------------------------------------------------------------

export async function recibirCompra(compraId: string): Promise<Resultado> {
  const { error } = await supabase.rpc('recibir_compra', {
    p_compra_id: compraId, p_usuario: usuarioActual(),
  })
  // El RPC rechaza las partidas sin producto ligado con el nombre de la
  // partida en el mensaje; se muestra tal cual.
  if (error) return { ok: false, error: error.message }

  revalidatePath('/compras')
  revalidatePath(`/compras/${compraId}`)
  revalidatePath('/inventario')
  revalidatePath('/movimientos')
  return { ok: true }
}

/** Liga una partida al catálogo desde el detalle, sin recapturar la compra. */
export async function ligarPartida(compraItemId: string, productoId: string, compraId: string): Promise<Resultado> {
  const { error } = await supabase
    .from('compra_items')
    .update({ producto_id: productoId })
    .eq('id', compraItemId)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/compras/${compraId}`)
  return { ok: true }
}
