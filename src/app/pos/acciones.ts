'use server'

// Server actions del punto de venta (minuta 7, 11, 16, 22, 23).
//
// Hoy las salidas se anotan en papel y la venta se captura en Aspel. Esta
// pantalla reemplaza las dos cosas: cada venta cerrada aquí descuenta el
// inventario de verdad, por lote y en la misma transacción
// (`pos_registrar_venta` -> `descontar_fefo` -> `registrar_movimiento`).
//
// Todo lo que toca la base vive aquí: el POSClient es un componente de
// cliente y no puede abrir una conexión a PostgreSQL.

import { revalidatePath } from 'next/cache'
import { sql, uno, qx } from '@/lib/db'
import { fijarUsuario, fijarSucursal } from '@/lib/usuario'
import { fechaEntregaEstimada, fechaISO, textoEntrega } from '@/lib/entrega'
import type { ProductoPOS, TipoCliente, FormaPago } from '@/lib/types'

// Un código de barras de producto trae entre 8 y 14 dígitos (EAN-8, UPC-A,
// EAN-13, ITF-14). Es lo único que se puede pegar a un producto.
const CODIGO = /^\d{8,14}$/

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

  const { data: filas, error } = await sql<ProductoPOS>(
    `select * from buscar_productos_pos($1, $2::uuid, $3)`,
    [texto, sucursalId, 10]
  )

  if (error) return { productos: [], error: error.message }
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
//  1-bis · Existencia al día, y códigos que todavía no existen
// ---------------------------------------------------------------------

// La forma de ProductoPOS, pero armada a mano para UN producto en UNA plaza.
// Se usa después de ligar un código: el producto tiene que entrar al carrito
// con la misma forma que si hubiera salido del buscador.
const SELECT_PRODUCTO_POS = `
  select p.id as producto_id, p.nombre, p.nombre_comercial, p.nombre_generico,
         p.concentracion, p.forma_farmaceutica, p.presentacion, p.laboratorio,
         p.codigo_barras, p.precio_base, coalesce(p.tasa_iva, 0) as tasa_iva,
         coalesce(p.controlado, false) as controlado,
         coalesce((select sum(i.existencia) from inventario i
                    where i.producto_id = p.id and i.sucursal_id = $2::uuid), 0) as existencia,
         coalesce((select sum(i.existencia) from inventario i
                    where i.producto_id = p.id
                      and i.sucursal_id is distinct from $2::uuid), 0) as existencia_otras,
         2.0::real as score,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'lote', i.lote, 'caducidad', i.caducidad,
                    'ubicacion', i.ubicacion, 'existencia', i.existencia,
                    'sucursal', s.clave) order by i.caducidad asc nulls last)
             from inventario i
             left join sucursales s on s.id = i.sucursal_id
            where i.producto_id = p.id
              and coalesce(i.existencia, 0) > 0
              and i.sucursal_id = $2::uuid
         ), '[]'::jsonb) as lotes
    from productos p
   where p.id = $1::uuid`

interface FilaExistencia {
  producto_id: string
  existencia: number | string | null
  existencia_otras: number | string | null
}

export interface ExistenciaAlDia {
  existencia: number
  existencia_otras: number
}

/**
 * Vuelve a leer la existencia de las partidas del carrito (punto 7).
 *
 * El carrito se queda con la existencia del momento en que se agregó el
 * producto. Si otra caja vendió mientras tanto —o si el dato estaba mal— el
 * aviso de sobregiro miente en las dos direcciones: alarma de más o deja
 * pasar de más. Esto lo vuelve a preguntar a la base.
 */
export async function refrescarExistencias(
  productoIds: string[],
  sucursalId: string,
): Promise<{ existencias: Record<string, ExistenciaAlDia>; error?: string }> {
  const ids = productoIds.filter(Boolean)
  if (!ids.length || !sucursalId) return { existencias: {} }

  const { data, error } = await sql<FilaExistencia>(
    `select p.id as producto_id,
            coalesce((select sum(i.existencia) from inventario i
                       where i.producto_id = p.id and i.sucursal_id = $2::uuid), 0) as existencia,
            coalesce((select sum(i.existencia) from inventario i
                       where i.producto_id = p.id
                         and i.sucursal_id is distinct from $2::uuid), 0) as existencia_otras
       from productos p
      where p.id = any($1::uuid[])`,
    [ids, sucursalId]
  )
  if (error) return { existencias: {}, error: error.message }

  const existencias: Record<string, ExistenciaAlDia> = {}
  for (const f of data) {
    existencias[f.producto_id] = {
      existencia: num(f.existencia),
      existencia_otras: num(f.existencia_otras),
    }
  }
  return { existencias }
}

// Lo que devuelve `asignar_codigo_barras`: cuántos productos vacíos absorbió
// y a cuántos —con historial— sólo les quitó el código.
interface RespuestaAsignacion {
  producto?: string
  codigo?: string
  fusionados?: number | string | null
  liberados?: number | string | null
}

/**
 * Liga un código de barras a un producto sin salir de la caja (punto 2).
 *
 * Hoy 49 de los 128 productos no tienen código: escanear su caja no encuentra
 * nada y la venta se atora. En vez de mandar a la persona al verificador con
 * el cliente enfrente, se elige el producto por nombre aquí mismo y el código
 * queda pegado para siempre.
 *
 * `asignar_codigo_barras` es la única puerta: si el código estaba en otro
 * producto, lo fusiona (si estaba vacío) o se lo quita y lo reporta (si tenía
 * historial). Un `update` a pelo dejaría dos productos con el mismo código.
 */
export async function ligarCodigoPOS(
  productoId: string,
  codigo: string,
  sucursalId: string,
): Promise<
  | { ok: true; producto: ProductoPOS; aviso: string | null }
  | { ok: false; error: string }
> {
  const c = codigo.trim()
  if (!CODIGO.test(c)) {
    return { ok: false, error: `"${c}" no parece un código de barras: deben ser de 8 a 14 dígitos.` }
  }
  if (!productoId) return { ok: false, error: 'Elige a qué producto pertenece el código.' }
  if (!sucursalId) return { ok: false, error: 'Falta la plaza: el inventario es por plaza.' }

  let r: RespuestaAsignacion | null = null
  try {
    const filas = await qx<{ r: RespuestaAsignacion }>(
      `select asignar_codigo_barras($1::uuid, $2) as r`,
      [productoId, c]
    )
    r = filas[0]?.r ?? null
  } catch (e) {
    // Los `raise exception` de la base vienen en español; se pasan tal cual.
    return { ok: false, error: (e as Error).message }
  }

  const { data: producto, error } = await uno<ProductoPOS>(SELECT_PRODUCTO_POS, [productoId, sucursalId])
  if (error) return { ok: false, error: error.message }
  if (!producto) return { ok: false, error: 'Ese producto ya no existe.' }

  const fusionados = num(r?.fusionados)
  const liberados = num(r?.liberados)
  const partes: string[] = []
  if (fusionados > 0) {
    partes.push(
      `Se ${fusionados === 1 ? 'fusionó 1 producto duplicado que estaba vacío' :
        `fusionaron ${fusionados} productos duplicados que estaban vacíos`} y tenía${fusionados === 1 ? '' : 'n'} ese código.`
    )
  }
  if (liberados > 0) {
    partes.push(
      liberados === 1
        ? 'Se le quitó el código a otro producto que sí tiene historial: quedó sin código de barras y hay que volver a escanear su caja en el verificador.'
        : `Se les quitó el código a ${liberados} productos que sí tienen historial: quedaron sin código de barras y hay que volver a escanear sus cajas en el verificador.`
    )
  }

  revalidatePath('/inventario')
  revalidatePath('/verificador')
  revalidatePath('/pos')

  return {
    ok: true,
    producto: {
      ...producto,
      precio_base: numONulo(producto.precio_base),
      tasa_iva: num(producto.tasa_iva),
      existencia: num(producto.existencia),
      existencia_otras: num(producto.existencia_otras),
      score: num(producto.score),
      controlado: producto.controlado === true,
      lotes: Array.isArray(producto.lotes) ? producto.lotes : [],
    },
    aviso: partes.length ? partes.join(' ') : null,
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
  busqueda: string,
): Promise<{ clientes: ClienteFila[]; error?: string }> {
  const texto = busqueda.trim()
  if (texto.length < 2) return { clientes: [] }

  // El % y el _ son comodines de LIKE: se escapan para que quien teclee
  // "100%" busque eso y no "cualquier cosa".
  const patron = '%' + texto.replace(/([%_\\])/g, '\\$1') + '%'

  const { data: filas, error } = await sql<ClienteFila>(
    `select id, nombre, empresa, tipo, ciudad, dias_credito, limite_credito, requiere_factura
       from clientes
      where nombre ilike $1 or empresa ilike $1
      order by nombre
      limit 8`,
    [patron]
  )

  if (error) return { clientes: [], error: error.message }
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

  // Los `raise exception` de Postgres vienen en español y son legibles para
  // el mostrador ("Existencia insuficiente: hay 3 y se intentan sacar 5."),
  // así que se dejan pasar tal cual.
  let r: RespuestaRPC | null = null
  try {
    const filas = await qx<{ r: RespuestaRPC }>(
      `select pos_registrar_venta($1::jsonb) as r`,
      [JSON.stringify(p)]
    )
    r = filas[0]?.r ?? null
  } catch (e) {
    return { ok: false as const, error: (e as Error).message }
  }
  if (!r?.venta_id) {
    return { ok: false as const, error: 'El servidor no devolvió la venta registrada.' }
  }

  // De qué lote salió cada producto: se relee `venta_items`, que es donde
  // `descontar_fefo` dejó el detalle (minuta 23).
  const { data: itemsData } = await sql<FilaItemVenta>(
    `select descripcion, cantidad, precio_unitario, descuento_pct, tasa_iva,
            subtotal, iva, total, lotes, posicion
       from venta_items
      where venta_id = $1::uuid
      order by posicion`,
    [r.venta_id]
  )

  const items = itemsData.map(it => ({
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
