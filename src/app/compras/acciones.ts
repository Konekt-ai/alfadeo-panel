'use server'

// Compras: captura al recibir mercancía (minuta 26) y lectura del CFDI del
// proveedor (minuta 29).
//
// La entrada al almacén NO se hace aquí: se hace en `recibir_compra`, que
// llama a `registrar_movimiento` por cada partida y crea los lotes que no
// existían. Así una compra capturada pero no recibida no infla el inventario.

import { revalidatePath } from 'next/cache'
import { sql, uno, qx, enTransaccion } from '@/lib/db'
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

  const { data, error } = await sql<ProductoPOS>(
    `select * from buscar_productos_pos($1, $2::uuid, $3)`,
    [texto, sucursalId, 8]
  )
  if (error) return { productos: [] as ProductoPOS[], error: error.message }
  return { productos: data }
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
    const { data: previa } = await uno<{ id: string; folio: string | null }>(
      `select id, folio from compras where factura_uuid = $1`, [cfdi.uuid]
    )
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
    const { data: porCodigo } = await sql<{ id: string; nombre: string; nombre_comercial: string | null }>(
      `select id, nombre, nombre_comercial from productos
        where codigo_barras = $1 limit 1`,
      [clave]
    )
    const p = porCodigo[0]
    if (p) {
      return { ...base, producto_id: p.id, producto_nombre: p.nombre_comercial ?? p.nombre, match: 'codigo' }
    }
  }

  // (b) Por nombre. Sólo se propone si el score es alto; por debajo de eso
  //     es peor sugerir mal que no sugerir.
  const { data: porNombre } = await sql<ProductoPOS>(
    `select * from buscar_productos_pos($1, $2::uuid, 1)`,
    [c.descripcion, sucursalId]
  )
  const sugerido = porNombre[0]
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

  // Folio, cabecera y partidas en UNA transacción: antes, si fallaban las
  // partidas había que borrar la compra a mano para no quemar el folio.
  let compra: { id: string }
  try {
    compra = await enTransaccion(async ejecutar => {
      const [{ folio }] = await ejecutar<{ folio: string | null }>(
        `select siguiente_folio('compra', $1::uuid) as folio`,
        [entrada.sucursal_id]
      )

      const [cab] = await ejecutar<{ id: string }>(
        `insert into compras (folio, proveedor_id, sucursal_id, fecha, estado,
                              subtotal, iva, total, moneda, factura_serie,
                              factura_folio, factura_uuid, emisor_rfc,
                              emisor_nombre, xml_origen, usuario, notas)
         values ($1, $2::uuid, $3::uuid, $4::date, 'borrador',
                 $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         returning id`,
        [
          folio, entrada.proveedor_id, entrada.sucursal_id, entrada.fecha,
          subtotal, iva, Math.round((subtotal + iva) * 100) / 100,
          entrada.moneda || 'MXN', entrada.factura_serie, entrada.factura_folio,
          entrada.factura_uuid, entrada.emisor_rfc, entrada.emisor_nombre,
          entrada.xml_origen, usuarioActual(), entrada.notas,
        ]
      )

      await ejecutar(
        `insert into compra_items
           (compra_id, producto_id, descripcion, clave_prov, codigo_barras,
            cantidad, costo_unitario, tasa_iva, lote, caducidad, ubicacion, posicion)
         select $1::uuid, u.producto_id::uuid, u.descripcion, u.clave_prov,
                u.codigo_barras, u.cantidad, u.costo_unitario, u.tasa_iva,
                u.lote, u.caducidad::date, u.ubicacion, u.posicion
           from unnest($2::text[], $3::text[], $4::text[], $5::text[],
                       $6::numeric[], $7::numeric[], $8::numeric[], $9::text[],
                       $10::text[], $11::text[], $12::int[])
                as u(producto_id, descripcion, clave_prov, codigo_barras,
                     cantidad, costo_unitario, tasa_iva, lote, caducidad,
                     ubicacion, posicion)`,
        [
          cab.id,
          entrada.partidas.map(p => p.producto_id),
          entrada.partidas.map(p => p.descripcion),
          entrada.partidas.map(p => p.clave_prov),
          entrada.partidas.map(p => p.codigo_barras),
          entrada.partidas.map(p => p.cantidad),
          entrada.partidas.map(p => p.costo_unitario),
          entrada.partidas.map(p => p.tasa_iva),
          entrada.partidas.map(p => p.lote),
          entrada.partidas.map(p => p.caducidad),
          entrada.partidas.map(p => p.ubicacion),
          entrada.partidas.map((_, i) => i + 1),
        ]
      )

      return cab
    })
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }

  let recibida = false
  if (entrada.recibir) {
    try {
      await qx(`select recibir_compra($1::uuid, $2)`, [compra.id, usuarioActual()])
      recibida = true
    } catch (e) {
      // La compra queda guardada en borrador: se puede recibir después sin
      // recapturarla. Se avisa qué falló.
      revalidatePath('/compras')
      return { ok: false, error: `La compra se guardó como borrador, pero no se pudo recibir: ${(e as Error).message}` }
    }
  }

  revalidatePath('/compras')
  revalidatePath('/inventario')
  return { ok: true, data: { id: compra.id, recibida } }
}

// ---------------------------------------------------------------------
//  4 · Recibir la mercancía (es lo que la mete al almacén)
// ---------------------------------------------------------------------

export async function recibirCompra(compraId: string): Promise<Resultado> {
  // La función rechaza las partidas sin producto ligado nombrando la
  // partida; el mensaje se muestra tal cual.
  try {
    await qx(`select recibir_compra($1::uuid, $2)`, [compraId, usuarioActual()])
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }

  revalidatePath('/compras')
  revalidatePath(`/compras/${compraId}`)
  revalidatePath('/inventario')
  revalidatePath('/movimientos')
  return { ok: true }
}

/** Liga una partida al catálogo desde el detalle, sin recapturar la compra. */
export async function ligarPartida(compraItemId: string, productoId: string, compraId: string): Promise<Resultado> {
  try {
    await qx(
      `update compra_items set producto_id = $1::uuid where id = $2::uuid`,
      [productoId, compraItemId]
    )
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }

  revalidatePath(`/compras/${compraId}`)
  return { ok: true }
}
