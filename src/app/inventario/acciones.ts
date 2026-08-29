'use server'

// Alta y edición de productos (puntos 1 y 4 del cliente).
//
//   (1) "Alta de productos: habilitar y facilitar el proceso para dar de alta
//        nuevos productos en el sistema."
//   (4) "Edición de productos más ágil: modificar información, subir contenido
//        y ajustar cantidades de forma rápida."
//
// Dos reglas atraviesan todo este archivo:
//
//   · **El inventario sólo se toca con `registrar_movimiento`.** Nunca un
//     insert ni un update directo sobre `inventario`: esa función bloquea el
//     lote, valida la existencia y deja el asiento en el kardex (minuta 8, 10).
//     Un update directo movería piezas sin que nadie pueda reclamar después.
//
//   · **El código de barras es la llave contra los duplicados.** El catálogo
//     traía 147 duplicados; antes de crear se pregunta si ese código ya existe,
//     y al reasignarlo se usa `asignar_codigo_barras`, que se lo quita a quien
//     lo tuviera y fusiona al otro producto si estaba vacío.

import { revalidatePath } from 'next/cache'
import { uno, qx, enTransaccion } from '@/lib/db'
import { usuarioActual } from '@/lib/usuario'

// ------------------------------------------------------------------ tipos --

export interface Resultado {
  ok?: boolean
  /** Confirmación de lo que quedó guardado. */
  mensaje?: string
  /** No se hizo nada, pero tampoco es un error (ajuste sin diferencia). */
  aviso?: string
  /** Texto del RPC o de la validación, tal cual. */
  error?: string
  /** Producto creado o afectado, para poder navegar a él. */
  producto_id?: string
  /** Otro producto que ya traía ese código de barras. */
  duplicado?: ProductoConCodigo
}

/** Lo que hace falta saber del producto que ya usa un código de barras. */
export interface ProductoConCodigo {
  id: string
  nombre: string
  codigo_barras: string | null
  activo: boolean
  existencia: number
}

/** Los campos del catálogo. `nombre` es el renglón completo que ve el POS. */
export interface DatosProducto {
  /** Renglón del catálogo. Si viene vacío se arma con los demás campos. */
  nombre: string | null
  codigo_barras: string | null
  nombre_comercial: string | null
  nombre_generico: string | null
  /** "Miligramos" en el lenguaje del cliente (minuta 17). */
  concentracion: string | null
  presentacion: string | null
  forma_farmaceutica: string | null
  laboratorio: string | null
  categoria: string | null
  precio_base: number | null
  /** 0 en medicamento de uso humano, 0.16 en material de curación (minuta 3). */
  tasa_iva: number
  controlado: boolean
  stock_minimo: number | null
}

/** Una entrada de mercancía: existencia inicial del alta, o lote nuevo. */
export interface EntradaLote {
  sucursal_id: string
  lote: string | null
  caducidad: string | null
  ubicacion: string | null
  piezas: number
  costo_unitario: number | null
  motivo: string | null
}

// ---------------------------------------------------------------- ayudas ---

const limpio = (v: string | null | undefined): string | null => {
  const s = (v ?? '').trim()
  return s === '' ? null : s
}

const numero = (v: number | null | undefined): number | null =>
  v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v)

// Las existencias son numeric(14,3): se redondea a 3 para que la resta de dos
// flotantes no invente diferencias de 0.0000001.
const tresDecimales = (n: number) => Math.round(n * 1000) / 1000

const piezas = (n: number) =>
  Number.isInteger(n) ? n.toLocaleString('es-MX') : tresDecimales(n).toLocaleString('es-MX')

/**
 * El renglón del catálogo armado con los cuatro campos de la minuta 17.
 * El formulario ya manda este mismo texto; esto es la red por si viene vacío.
 */
function nombreDeCatalogo(d: DatosProducto): string {
  const generico =
    d.nombre_generico && d.nombre_generico !== d.nombre_comercial ? d.nombre_generico : null
  return [d.nombre_comercial, generico, d.forma_farmaceutica, d.concentracion, d.presentacion]
    .map(p => (p ?? '').trim())
    .filter(Boolean)
    .join(' ')
}

function refrescar(productoId?: string) {
  revalidatePath('/inventario')
  revalidatePath('/movimientos')
  if (productoId) revalidatePath(`/inventario/${productoId}`)
}

// ------------------------------------------------- código de barras ---------

/**
 * ¿Ya hay un producto con este código? Es la pregunta que evita el duplicado
 * número 148: se escanea la caja ANTES de capturar nada.
 */
export async function buscarPorCodigo(
  codigo: string,
): Promise<{ producto: ProductoConCodigo | null; error?: string }> {
  const c = limpio(codigo)
  if (!c) return { producto: null }

  const { data, error } = await uno<ProductoConCodigo>(
    `select p.id,
            coalesce(p.nombre_comercial, p.nombre_generico, p.nombre) as nombre,
            p.codigo_barras,
            p.activo,
            coalesce((select sum(i.existencia) from inventario i
                       where i.producto_id = p.id), 0) as existencia
       from productos p
      where p.codigo_barras = $1
      order by p.activo desc
      limit 1`,
    [c],
  )

  if (error) return { producto: null, error: error.message }
  return { producto: data }
}

// ------------------------------------------------------------------- alta ---

/**
 * Da de alta el producto y, si se capturó, su existencia inicial. Las dos
 * cosas en la misma transacción: un producto creado cuya entrada falló dejaría
 * al operador creyendo que ya tiene piezas.
 */
export async function crearProducto(
  datos: DatosProducto,
  inicial: EntradaLote | null,
): Promise<Resultado> {
  const comercial = limpio(datos.nombre_comercial)
  const generico = limpio(datos.nombre_generico)
  if (!comercial && !generico) {
    return { error: 'Escribe al menos el nombre comercial o el genérico del producto.' }
  }

  const codigo = limpio(datos.codigo_barras)
  if (codigo) {
    const { producto: otro, error } = await buscarPorCodigo(codigo)
    if (error) return { error }
    if (otro) {
      return {
        error: `El código ${codigo} ya lo tiene "${otro.nombre}". No lo des de alta otra vez: abre ese producto y corrígelo ahí.`,
        duplicado: otro,
      }
    }
  }

  const conEntrada = !!inicial && Number(inicial.piezas) > 0
  const usuario = usuarioActual()
  if (conEntrada) {
    if (!inicial!.sucursal_id) {
      return { error: 'Elige la plaza de la existencia inicial: el inventario es por plaza.' }
    }
    if (!usuario) {
      return {
        error:
          'Antes de meter piezas al inventario hay que decir quién lo hace. ' +
          'Elige tu nombre arriba y vuelve a guardar.',
      }
    }
  }

  const nombre = limpio(datos.nombre) ?? nombreDeCatalogo(datos)
  const tasa = Number(datos.tasa_iva) === 0.16 ? 0.16 : 0

  let productoId = ''
  try {
    productoId = await enTransaccion(async ejecutar => {
      // `iva_exento` se escribe en espejo de la tasa porque el cotizador
      // todavía lee esa columna; `tasa_iva` sigue siendo la fuente de verdad
      // para facturar (minuta 3).
      const [prod] = await ejecutar<{ id: string }>(
        `insert into productos (
           nombre, nombre_comercial, nombre_generico, concentracion,
           forma_farmaceutica, presentacion, laboratorio, categoria,
           codigo_barras, precio_base, tasa_iva, iva_exento, controlado,
           stock_minimo, activo)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                 coalesce($14::numeric, 0), true)
         returning id`,
        [
          nombre,
          comercial,
          generico,
          limpio(datos.concentracion),
          limpio(datos.forma_farmaceutica),
          limpio(datos.presentacion),
          limpio(datos.laboratorio),
          limpio(datos.categoria),
          codigo,
          numero(datos.precio_base),
          tasa,
          tasa === 0,
          !!datos.controlado,
          numero(datos.stock_minimo),
        ],
      )

      if (conEntrada) {
        await ejecutar(
          `select registrar_movimiento(
                    p_producto_id     => $1::uuid,
                    p_sucursal_id     => $2::uuid,
                    p_cantidad        => $3,
                    p_tipo            => 'entrada',
                    p_lote            => $4,
                    p_ubicacion       => $5,
                    p_caducidad       => $6::date,
                    p_costo_unitario  => $7,
                    p_motivo          => $8,
                    p_referencia_tipo => 'manual',
                    p_usuario         => $9)`,
          [
            prod.id,
            inicial!.sucursal_id,
            tresDecimales(Number(inicial!.piezas)),
            limpio(inicial!.lote),
            limpio(inicial!.ubicacion),
            limpio(inicial!.caducidad),
            numero(inicial!.costo_unitario),
            limpio(inicial!.motivo) ?? 'Alta de producto',
            usuario,
          ],
        )
      }

      return prod.id
    })
  } catch (e) {
    return { error: (e as Error).message }
  }

  refrescar(productoId)

  return {
    ok: true,
    producto_id: productoId,
    mensaje: conEntrada
      ? `Listo: "${nombre}" dado de alta con ${piezas(Number(inicial!.piezas))} pza de existencia inicial.`
      : `Listo: "${nombre}" dado de alta. Todavía sin existencia.`,
  }
}

// --------------------------------------------------------------- edición ---

/**
 * Guarda los datos del catálogo. El código de barras se trata aparte: si ya es
 * de otro producto primero se avisa, y sólo con `reasignarCodigo` se llama a
 * `asignar_codigo_barras`, que se lo quita al otro (y lo fusiona si estaba
 * vacío).
 */
export async function actualizarProducto(
  id: string,
  datos: DatosProducto,
  reasignarCodigo = false,
): Promise<Resultado> {
  if (!id) return { error: 'Falta el producto que se está editando.' }

  const comercial = limpio(datos.nombre_comercial)
  const generico = limpio(datos.nombre_generico)
  if (!comercial && !generico) {
    return { error: 'Escribe al menos el nombre comercial o el genérico del producto.' }
  }

  const { data: actual, error: errActual } = await uno<{ codigo_barras: string | null }>(
    `select codigo_barras from productos where id = $1::uuid`,
    [id],
  )
  if (errActual) return { error: errActual.message }
  if (!actual) return { error: 'Ese producto ya no existe en el catálogo.' }

  const codigo = limpio(datos.codigo_barras)
  const cambiaCodigo = codigo !== (actual.codigo_barras ?? null)

  // ¿El código nuevo es de alguien más? Se pregunta antes de escribir nada.
  let otro: ProductoConCodigo | null = null
  if (cambiaCodigo && codigo) {
    const { data: dueno, error } = await uno<ProductoConCodigo>(
      `select p.id,
              coalesce(p.nombre_comercial, p.nombre_generico, p.nombre) as nombre,
              p.codigo_barras, p.activo,
              coalesce((select sum(i.existencia) from inventario i
                         where i.producto_id = p.id), 0) as existencia
         from productos p
        where p.codigo_barras = $1 and p.id <> $2::uuid
        limit 1`,
      [codigo, id],
    )
    if (error) return { error: error.message }
    otro = dueno
    if (otro && !reasignarCodigo) {
      return {
        error: `El código ${codigo} lo tiene "${otro.nombre}". Si de verdad es de este producto, confirma la reasignación.`,
        duplicado: otro,
      }
    }
  }

  const nombre = limpio(datos.nombre) ?? nombreDeCatalogo(datos)
  const tasa = Number(datos.tasa_iva) === 0.16 ? 0.16 : 0

  try {
    // Primero los datos del catálogo, sin el código de barras.
    await qx(
      `update productos
          set nombre             = $1,
              nombre_comercial   = $2,
              nombre_generico    = $3,
              concentracion      = $4,
              forma_farmaceutica = $5,
              presentacion       = $6,
              laboratorio        = $7,
              categoria          = $8,
              precio_base        = $9,
              tasa_iva           = $10,
              iva_exento         = $11,
              controlado         = $12,
              stock_minimo       = coalesce($13::numeric, 0),
              updated_at         = now()
        where id = $14::uuid`,
      [
        nombre,
        comercial,
        generico,
        limpio(datos.concentracion),
        limpio(datos.forma_farmaceutica),
        limpio(datos.presentacion),
        limpio(datos.laboratorio),
        limpio(datos.categoria),
        numero(datos.precio_base),
        tasa,
        tasa === 0,
        !!datos.controlado,
        numero(datos.stock_minimo),
        id,
      ],
    )
  } catch (e) {
    return { error: (e as Error).message }
  }

  // Después el código, que puede arrastrar a otro producto.
  let notaCodigo = ''
  if (cambiaCodigo) {
    try {
      if (!codigo) {
        await qx(`update productos set codigo_barras = null where id = $1::uuid`, [id])
        notaCodigo = ' Se le quitó el código de barras.'
      } else {
        const [r] = await qx<{ r: { fusionados?: number; liberados?: number } | null }>(
          `select asignar_codigo_barras($1::uuid, $2) as r`,
          [id, codigo],
        )
        const fusionados = Number(r?.r?.fusionados ?? 0)
        const liberados = Number(r?.r?.liberados ?? 0)
        notaCodigo =
          ` Código ${codigo} asignado.` +
          (fusionados ? ` Se absorbió ${fusionados} producto duplicado que estaba vacío.` : '') +
          (liberados ? ` Se le quitó a ${liberados} producto con historial, que quedó sin código.` : '')
      }
    } catch (e) {
      // Los datos ya se guardaron: hay que decirlo, no fingir que falló todo.
      refrescar(id)
      return {
        ok: true,
        producto_id: id,
        aviso: `Los datos se guardaron, pero el código de barras no: ${(e as Error).message}`,
      }
    }
  }

  refrescar(id)
  return { ok: true, producto_id: id, mensaje: `Guardado: "${nombre}".${notaCodigo}` }
}

/** Baja lógica. Un producto inactivo no se vende, pero conserva su historial. */
export async function cambiarActivo(id: string, activo: boolean): Promise<Resultado> {
  if (!id) return { error: 'Falta el producto.' }
  try {
    await qx(`update productos set activo = $1, updated_at = now() where id = $2::uuid`, [activo, id])
  } catch (e) {
    return { error: (e as Error).message }
  }
  refrescar(id)
  return {
    ok: true,
    producto_id: id,
    mensaje: activo ? 'Producto reactivado.' : 'Producto desactivado.',
  }
}

// -------------------------------------------------------------- cantidades -

/**
 * Cuadra un lote contra el conteo físico. El operador captura lo que CONTÓ; la
 * diferencia se calcula aquí, releyendo la existencia del sistema en este
 * momento (no la que vio el navegador hace un minuto), y se manda firmada.
 * Diferencia cero = no se llama al RPC: un asiento de cero no dice nada.
 */
export async function ajustarLote(
  inventarioId: string,
  contado: number,
  motivo: string | null,
): Promise<Resultado> {
  if (!inventarioId) return { error: 'Falta el lote que se está ajustando.' }

  const real = Number(contado)
  if (!Number.isFinite(real) || real < 0) {
    return { error: 'La existencia contada no es un número válido.' }
  }

  const usuario = usuarioActual()
  if (!usuario) {
    return {
      error:
        'Antes de ajustar inventario hay que decir quién lo hace. ' +
        'Elige tu nombre arriba y vuelve a intentar.',
    }
  }

  const { data: fila, error } = await uno<{
    producto_id: string
    sucursal_id: string | null
    existencia: number | null
    lote: string | null
    ubicacion: string | null
    caducidad: string | null
  }>(
    `select producto_id, sucursal_id, existencia, lote, ubicacion, caducidad
       from inventario where id = $1::uuid`,
    [inventarioId],
  )
  if (error) return { error: error.message }
  if (!fila) return { error: 'Ese lote ya no existe.' }
  if (!fila.sucursal_id) {
    return { error: 'Ese renglón de inventario no tiene plaza; no se puede ajustar hasta corregirlo.' }
  }

  const enSistema = Number(fila.existencia ?? 0)
  const diferencia = tresDecimales(real - enSistema)

  if (diferencia === 0) {
    return {
      aviso: `El lote ${fila.lote || 'sin lote'} ya cuadra: el sistema tiene ${piezas(enSistema)} pza y contaste lo mismo.`,
    }
  }

  try {
    await qx(
      `select registrar_movimiento(
                p_producto_id     => $1::uuid,
                p_sucursal_id     => $2::uuid,
                p_cantidad        => $3,
                p_tipo            => 'ajuste',
                p_lote            => $4,
                p_ubicacion       => $5,
                p_caducidad       => $6::date,
                p_motivo          => $7,
                p_referencia_tipo => 'manual',
                p_usuario         => $8,
                p_inventario_id   => $9::uuid)`,
      [
        fila.producto_id,
        fila.sucursal_id,
        diferencia,
        fila.lote,
        fila.ubicacion,
        fila.caducidad,
        limpio(motivo) ?? 'Ajuste por conteo físico',
        usuario,
        inventarioId,
      ],
    )
  } catch (e) {
    return { error: (e as Error).message }
  }

  refrescar(fila.producto_id)
  const signo = diferencia > 0 ? '+' : '−'
  return {
    ok: true,
    producto_id: fila.producto_id,
    mensaje: `Lote ${fila.lote || 'sin lote'} ajustado: ${piezas(enSistema)} → ${piezas(real)} pza (${signo}${piezas(Math.abs(diferencia))}).`,
  }
}

/** Lote nuevo del mismo producto: entra por `registrar_movimiento`, con kardex. */
export async function agregarLote(productoId: string, entrada: EntradaLote): Promise<Resultado> {
  if (!productoId) return { error: 'Falta el producto.' }
  if (!entrada.sucursal_id) return { error: 'Elige la plaza: el inventario es por plaza.' }

  const cantidad = Number(entrada.piezas)
  if (!Number.isFinite(cantidad) || cantidad <= 0) {
    return { error: 'Las piezas que entran tienen que ser más que cero.' }
  }

  const usuario = usuarioActual()
  if (!usuario) {
    return {
      error:
        'Antes de meter piezas al inventario hay que decir quién lo hace. ' +
        'Elige tu nombre arriba y vuelve a intentar.',
    }
  }

  try {
    await qx(
      `select registrar_movimiento(
                p_producto_id     => $1::uuid,
                p_sucursal_id     => $2::uuid,
                p_cantidad        => $3,
                p_tipo            => 'entrada',
                p_lote            => $4,
                p_ubicacion       => $5,
                p_caducidad       => $6::date,
                p_costo_unitario  => $7,
                p_motivo          => $8,
                p_referencia_tipo => 'manual',
                p_usuario         => $9)`,
      [
        productoId,
        entrada.sucursal_id,
        tresDecimales(cantidad),
        limpio(entrada.lote),
        limpio(entrada.ubicacion),
        limpio(entrada.caducidad),
        numero(entrada.costo_unitario),
        limpio(entrada.motivo) ?? 'Compra a proveedor',
        usuario,
      ],
    )
  } catch (e) {
    return { error: (e as Error).message }
  }

  refrescar(productoId)
  return {
    ok: true,
    producto_id: productoId,
    mensaje: `Entrada de ${piezas(cantidad)} pza${entrada.lote ? ` · lote ${entrada.lote}` : ''}.`,
  }
}
