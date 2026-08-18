'use server'

// Verificador de código de barras (minuta 13, 19, 20, 22).
//
// Resuelve el cuello de botella que hoy tiene parado al punto de venta:
// `productos.codigo_barras` está vacío, así que la pistola no encuentra
// nada. Aquí los empleados van pasando cajas por el lector y les pegan su
// medicamento del catálogo, de dos en dos segundos.
//
// Y de paso sirve de verificador de precios: si el código ya está
// registrado, muestra el producto en grande.

import { revalidatePath } from 'next/cache'
import { sql, uno, qx } from '@/lib/db'
import { usuarioActual } from '@/lib/usuario'
import type { ProductoPOS, Lote } from '@/lib/types'

// El lector HID teclea dígitos y cierra con Enter. Un código de barras de
// producto tiene entre 8 y 14 dígitos (EAN-8, UPC-A, EAN-13, ITF-14).
const CODIGO = /^\d{8,14}$/

export interface ProductoEncontrado {
  producto_id: string
  nombre: string
  nombre_comercial: string | null
  nombre_generico: string | null
  concentracion: string | null
  forma_farmaceutica: string | null
  presentacion: string | null
  laboratorio: string | null
  codigo_barras: string | null
  precio_base: number | null
  tasa_iva: number
  controlado: boolean
  existencia_total: number
  // Existencia por plaza, para decir dónde hay (minuta 28).
  plazas: Array<{ sucursal: string; existencia: number }>
  lotes: Lote[]
}

const SELECT_PRODUCTO = `
  select p.id as producto_id, p.nombre, p.nombre_comercial, p.nombre_generico,
         p.concentracion, p.forma_farmaceutica, p.presentacion, p.laboratorio,
         p.codigo_barras, p.precio_base, coalesce(p.tasa_iva, 0) as tasa_iva,
         coalesce(p.controlado, false) as controlado,
         coalesce((select sum(i.existencia) from inventario i
                    where i.producto_id = p.id), 0) as existencia_total,
         coalesce((
           select json_agg(x order by x.sucursal)
             from (select s.clave as sucursal, sum(i.existencia) as existencia
                     from inventario i
                     join sucursales s on s.id = i.sucursal_id
                    where i.producto_id = p.id and i.existencia > 0
                    group by s.clave) x
         ), '[]'::json) as plazas,
         coalesce((
           select json_agg(json_build_object(
                    'lote', i.lote, 'caducidad', i.caducidad,
                    'ubicacion', i.ubicacion, 'existencia', i.existencia,
                    'sucursal', s.clave) order by i.caducidad asc nulls last)
             from inventario i
             left join sucursales s on s.id = i.sucursal_id
            where i.producto_id = p.id and i.existencia > 0
         ), '[]'::json) as lotes
    from productos p`

// ---------------------------------------------------------------------
//  1 · Escaneo: ¿este código ya está registrado?
// ---------------------------------------------------------------------

export async function consultarCodigo(codigo: string): Promise<{
  estado: 'encontrado' | 'no_registrado' | 'invalido'
  producto?: ProductoEncontrado
  codigo: string
  error?: string
}> {
  const c = codigo.trim()
  if (!CODIGO.test(c)) {
    return { estado: 'invalido', codigo: c }
  }

  const { data, error } = await uno<ProductoEncontrado>(
    `${SELECT_PRODUCTO} where p.codigo_barras = $1`,
    [c]
  )
  if (error) return { estado: 'invalido', codigo: c, error: error.message }

  return data
    ? { estado: 'encontrado', producto: data, codigo: c }
    : { estado: 'no_registrado', codigo: c }
}

// ---------------------------------------------------------------------
//  2 · Buscar el medicamento por nombre para ligarlo
// ---------------------------------------------------------------------

export async function buscarPorNombre(
  texto: string
): Promise<{ productos: ProductoPOS[]; error?: string }> {
  const t = texto.trim()
  if (t.length < 2) return { productos: [] }

  // El mismo RPC del punto de venta: pondera el nombre comercial sobre el
  // genérico, que es como los busca el equipo (minuta 20).
  const { data, error } = await sql<ProductoPOS>(
    `select * from buscar_productos_pos($1, null, 12)`,
    [t]
  )
  if (error) return { productos: [], error: error.message }
  return { productos: data }
}

// ---------------------------------------------------------------------
//  3 · Registrar: pegarle el código al producto
// ---------------------------------------------------------------------

export async function registrarCodigo(
  productoId: string,
  codigo: string,
  confirmado = false
): Promise<
  | { ok: true; producto: ProductoEncontrado }
  | { ok: false; error: string }
  | { ok: false; confirmar: string }
> {
  const c = codigo.trim()
  if (!CODIGO.test(c)) {
    return { ok: false, error: `"${c}" no parece un código de barras (deben ser 8 a 14 dígitos).` }
  }
  if (!productoId) return { ok: false, error: 'Elige a qué medicamento pertenece.' }

  // Dos comprobaciones antes de pisar nada. Sin ellas se puede borrar en
  // silencio el trabajo de otra persona.
  const { data: destino } = await uno<{ nombre: string; codigo_barras: string | null }>(
    `select coalesce(nombre_comercial, nombre_generico, nombre) as nombre, codigo_barras
       from productos where id = $1::uuid`,
    [productoId]
  )
  if (!destino) return { ok: false, error: 'Ese producto ya no existe.' }

  const { data: ocupado } = await uno<{ id: string; nombre: string }>(
    `select id, coalesce(nombre_comercial, nombre_generico, nombre) as nombre
       from productos where codigo_barras = $1 and id <> $2::uuid`,
    [c, productoId]
  )

  if (!confirmado) {
    if (ocupado) {
      return {
        ok: false,
        confirmar: `Ese código ya está en "${ocupado.nombre}". Si continúas, se lo quitas a ese producto y se lo pones a "${destino.nombre}".`,
      }
    }
    if (destino.codigo_barras && destino.codigo_barras !== c) {
      return {
        ok: false,
        confirmar: `"${destino.nombre}" ya tenía el código ${destino.codigo_barras}. Si continúas, se reemplaza por ${c}.`,
      }
    }
  }

  try {
    // Si el código estaba en otro producto se le quita primero: la columna
    // no tiene índice único, así que sin esto quedarían dos productos con
    // el mismo código y el POS elegiría al azar.
    if (ocupado) {
      await qx(`update productos set codigo_barras = null where id = $1::uuid`, [ocupado.id])
    }
    await qx(`update productos set codigo_barras = $1 where id = $2::uuid`, [c, productoId])
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }

  const { data: producto } = await uno<ProductoEncontrado>(
    `${SELECT_PRODUCTO} where p.id = $1::uuid`,
    [productoId]
  )

  revalidatePath('/verificador')
  revalidatePath('/inventario')

  return { ok: true, producto: producto! }
}

// ---------------------------------------------------------------------
//  4 · Avance del trabajo
// ---------------------------------------------------------------------

export async function avance(): Promise<{ total: number; con: number }> {
  const { data } = await uno<{ total: number; con: number }>(
    `select count(*)::int as total,
            count(codigo_barras)::int as con
       from productos where coalesce(activo, true)`
  )
  return { total: data?.total ?? 0, con: data?.con ?? 0 }
}

/**
 * Un producto que todavía no tiene código, para ir al revés: buscar la caja
 * en el anaquel en vez de esperar a que llegue. Alfabético, para que dos
 * personas trabajando a la vez no se topen con el mismo.
 */
export async function siguienteSinCodigo(
  saltar: string[] = []
): Promise<{ producto: ProductoEncontrado | null }> {
  const { data } = await uno<ProductoEncontrado>(
    `${SELECT_PRODUCTO}
      where p.codigo_barras is null
        and coalesce(p.activo, true)
        and not (p.id = any($1::uuid[]))
      order by coalesce(p.nombre_comercial, p.nombre_generico, p.nombre)
      limit 1`,
    [saltar]
  )
  return { producto: data }
}

/** Firma quién estuvo registrando, para saber a quién preguntarle. */
export async function quienRegistra(): Promise<string | null> {
  return usuarioActual()
}
