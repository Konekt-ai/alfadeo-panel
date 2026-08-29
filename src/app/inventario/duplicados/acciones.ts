'use server'

// Acciones de la pantalla de duplicados (/inventario/duplicados).
//
// El catálogo llegó a tener 281 productos para 134 nombres reales. La
// migración `catalogo-limpio.sql` ya lo dejó en 128, pero el problema se
// repite en cuanto alguien da de alta un producto que ya existía. Esto es
// lo que permite resolverlo desde el panel, sin abrir la base.
//
// Aquí NO se escribe inventario a mano. Fusionar pasa por
// `consolidar_productos()`, que reapunta las 10 tablas que referencian
// productos, suma el inventario que choque y borra los sobrantes en una
// sola transacción. Hacerlo por partes desde aquí dejaría ventas huérfanas
// si algo tronara a la mitad.

import { revalidatePath } from 'next/cache'
import { qx } from '@/lib/db'

/** Forma de respuesta que esperan los formularios del panel. */
export type Respuesta<T> = ({ ok: true } & T) | { ok: false; error: string }

// Los ids llegan del navegador. Se validan antes de mandarlos a Postgres
// para no devolverle a la persona un "invalid input syntax for type uuid".
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// `consolidar_productos` devuelve jsonb { destino, fusionados }. No está
// fijado si `fusionados` es la cuenta o la lista de ids que se borraron;
// se acepta cualquiera de las dos y, si no se entiende, se usa cuántos se
// mandaron, que es el dato que se tiene de este lado.
function cuantosFusionados(valor: unknown, porDefecto: number): number {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor
  if (Array.isArray(valor)) return valor.length
  if (typeof valor === 'string' && Number.isFinite(Number(valor))) return Number(valor)
  return porDefecto
}

function nombreVisible(p: { nombre_comercial: string | null; nombre: string | null }): string {
  return p.nombre_comercial || p.nombre || 'el producto seleccionado'
}

/**
 * Fusiona las copias en el producto elegido. Es irreversible y mueve
 * existencia: quien llama debe haber pedido confirmación antes.
 *
 * El historial NO se pierde. Las ventas, movimientos y documentos viejos
 * de las copias quedan apuntando al producto que sobrevive.
 */
export async function fusionarProductos(
  destino: string,
  origenes: string[],
): Promise<Respuesta<{ mensaje: string; fusionados: number }>> {
  if (!UUID.test(destino ?? '')) {
    return { ok: false, error: 'No se reconoce el producto que se quiere conservar. Vuelve a cargar la pantalla.' }
  }

  // Se quita el destino de la lista de orígenes: fusionar un producto
  // consigo mismo lo borraría.
  const ids = Array.from(new Set((origenes ?? []).filter(id => UUID.test(id) && id !== destino)))
  if (ids.length === 0) {
    return { ok: false, error: 'No hay copias que fusionar en este grupo.' }
  }

  try {
    const filas = await qx<{ resultado: Record<string, unknown> | null }>(
      `select consolidar_productos($1::uuid, $2::uuid[]) as resultado`,
      [destino, ids],
    )
    const fusionados = cuantosFusionados(filas[0]?.resultado?.fusionados, ids.length)

    const [producto] = await qx<{ nombre: string | null; nombre_comercial: string | null }>(
      `select nombre, nombre_comercial from productos where id = $1::uuid`,
      [destino],
    )

    revalidatePath('/inventario/duplicados')
    revalidatePath('/inventario')

    return {
      ok: true,
      fusionados,
      mensaje:
        `Listo: ${fusionados === 1 ? 'se fusionó 1 copia' : `se fusionaron ${fusionados} copias`} en ` +
        `"${producto ? nombreVisible(producto) : 'el producto elegido'}". ` +
        'La existencia se sumó y las ventas y movimientos viejos ahora apuntan a ese producto.',
    }
  } catch (e) {
    // Los `raise exception` de la función vienen redactados en español.
    return { ok: false, error: (e as Error).message }
  }
}

/**
 * Le quita el código de barras a un producto y lo deja libre para el otro.
 *
 * Es el desempate del caso que no se puede fusionar: dos productos
 * DISTINTOS que comparten código y los dos con existencia (hoy, los dos
 * MICROBIOT con el 7506400900399). Fusionarlos revolvería existencia de
 * dos medicamentos que no son el mismo; quitarle el código a uno no pierde
 * nada — sólo deja de poder escanearse hasta que se le capture el suyo.
 */
export async function quitarCodigoBarras(
  productoId: string,
): Promise<Respuesta<{ mensaje: string }>> {
  if (!UUID.test(productoId ?? '')) {
    return { ok: false, error: 'No se reconoce el producto. Vuelve a cargar la pantalla.' }
  }

  try {
    // El `returning` de un update entrega el valor NUEVO (null). El código
    // que se quitó se lee del CTE para poder nombrarlo en el mensaje.
    const filas = await qx<{
      nombre: string | null
      nombre_comercial: string | null
      codigo_anterior: string | null
    }>(
      `with antes as (
         select id, nombre, nombre_comercial, codigo_barras
           from productos
          where id = $1::uuid
       )
       update productos p
          set codigo_barras = null
         from antes
        where p.id = antes.id
       returning antes.nombre, antes.nombre_comercial,
                 antes.codigo_barras as codigo_anterior`,
      [productoId],
    )

    const fila = filas[0]
    if (!fila) {
      return { ok: false, error: 'Ese producto ya no existe. Vuelve a cargar la pantalla.' }
    }

    revalidatePath('/inventario/duplicados')
    revalidatePath('/inventario')

    if (!fila.codigo_anterior) {
      return { ok: true, mensaje: `"${nombreVisible(fila)}" ya no tenía código de barras.` }
    }

    return {
      ok: true,
      mensaje:
        `Se le quitó el código ${fila.codigo_anterior} a "${nombreVisible(fila)}". ` +
        'El código queda para el otro producto; a éste hay que capturarle el suyo para poder escanearlo.',
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
