'use server'

// Carga de existencias desde el Excel del conteo de almacén.
//
// El importador de Aspel (../importar) a propósito NO toca piezas. Éste sí,
// pero sin saltarse la regla del inventario: cada lote se cuadra con
// `registrar_movimiento`, igual que un ajuste por conteo físico. El kardex
// queda con cuántas había, cuántas se contaron, quién lo cargó y de qué
// archivo.
//
// Lo que no viene en el Excel no se toca. Para empezar de cero, antes se
// corre instalacion\existencias-en-cero.ps1.

import { revalidatePath } from 'next/cache'
import { sql, enTransaccion } from '@/lib/db'
import { usuarioActual } from '@/lib/usuario'
import type { ProductoPOS } from '@/lib/types'

// ------------------------------------------------------------------ tipos --

export interface ProductoBuscado {
  indice: number
  codigo_barras: string | null
  marca: string | null
  nombre: string | null
}

export type TipoMatch = 'codigo' | 'nombre' | 'nuevo' | 'ambiguo'

export interface Candidato {
  id: string
  nombre: string
  codigo_barras: string | null
  /** null cuando el match fue por código: no hay ranking. */
  score: number | null
}

export interface ProductoEvaluado {
  indice: number
  match: TipoMatch
  /** El que se usa si nadie lo cambia. null en 'nuevo' y 'ambiguo'. */
  producto_id: string | null
  candidatos: Candidato[]
  /** El producto existe pero está dado de baja: se reactiva al cargarle piezas. */
  inactivo: boolean
  nota: string | null
}

export interface LoteContado {
  renglon: number
  /** Producto elegido en la vista previa. null = darlo de alta. */
  producto_id: string | null
  codigo_barras: string | null
  marca: string | null
  nombre: string | null
  laboratorio: string | null
  lote: string | null
  caducidad: string | null
  ubicacion: string | null
  piezas: number
}

export interface ResumenCarga {
  lotesAjustados: number
  lotesNuevos: number
  /** El lote ya tenía exactamente lo contado. */
  sinCambio: number
  /** Contado en 0 y sin lote que bajar: no hay nada que registrar. */
  enCero: number
  productosNuevos: number
  codigosAsignados: number
  reactivados: number
  piezas: number
  omitidos: string[]
}

// ---------------------------------------------------------------- ayudas ---

const esCodigoBarras = (s: string | null): boolean => !!s && /^\d{8,14}$/.test(s)

const norm = (v: unknown) =>
  String(v ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

// Las existencias son numeric(14,3): se redondea a 3 para que la resta de dos
// flotantes no invente diferencias de 0.0000001.
const tresDecimales = (n: number) => Math.round(n * 1000) / 1000

// --------------------------------------------------------------- evaluar ---

/**
 * Dice a qué producto del catálogo corresponde cada renglón. No escribe
 * nada: es la vista previa que alguien aprueba.
 *
 * Primero el código de barras, que es exacto. Si no, el ranking de nombre
 * del POS, con la marca adelante porque así se distinguen dos genéricos
 * iguales de laboratorios distintos (BEDARA y BILUMIV son la misma
 * bicalutamida).
 */
export async function evaluarProductos(
  filas: ProductoBuscado[],
): Promise<{ evaluados: ProductoEvaluado[]; error?: string }> {
  const codigos = Array.from(new Set(filas.map(f => f.codigo_barras).filter(esCodigoBarras))) as string[]

  const porCodigo = new Map<string, Candidato & { activo: boolean }>()
  if (codigos.length) {
    // El código del catálogo y, si alguna vez se guardó, el alterno de
    // producto_codigos. El activo gana si hay dos.
    const { data, error } = await sql<Candidato & { codigo: string; activo: boolean }>(
      `select c.codigo, p.id,
              coalesce(p.nombre_comercial, p.nombre_generico, p.nombre) as nombre,
              p.codigo_barras, null::numeric as score, p.activo
         from productos p
         join (select id as producto_id, codigo_barras as codigo from productos
                where codigo_barras = any($1::text[])
               union
               select producto_id, codigo from producto_codigos
                where codigo = any($1::text[])) c on c.producto_id = p.id
        order by p.activo desc`,
      [codigos],
    )
    if (error) return { evaluados: [], error: error.message }
    for (const p of data) if (!porCodigo.has(p.codigo)) porCodigo.set(p.codigo, p)
  }

  const evaluados: ProductoEvaluado[] = []
  for (const f of filas) {
    const exacto = f.codigo_barras ? porCodigo.get(f.codigo_barras) : undefined
    if (exacto) {
      evaluados.push({
        indice: f.indice, match: 'codigo', producto_id: exacto.id,
        candidatos: [{ id: exacto.id, nombre: exacto.nombre, codigo_barras: exacto.codigo_barras, score: null }],
        inactivo: !exacto.activo,
        nota: exacto.activo ? null : 'Está dado de baja en el catálogo; se reactiva al cargarle piezas.',
      })
      continue
    }

    const buscar = [f.marca, f.nombre].filter(Boolean).join(' ')
    if (!buscar) {
      evaluados.push({ indice: f.indice, match: 'nuevo', producto_id: null, candidatos: [], inactivo: false, nota: null })
      continue
    }

    const { data: rs, error } = await sql<ProductoPOS>(
      `select * from buscar_productos_pos($1, null, 3)`,
      [buscar],
    )
    if (error) return { evaluados: [], error: error.message }

    // Se ofrecen como opción aunque no lleguen al corte: quien revisa puede
    // reconocer el producto aunque el nombre esté escrito distinto.
    const candidatos: Candidato[] = rs
      .filter(r => Number(r.score) >= 0.5)
      .map(r => ({
        id: r.producto_id,
        nombre: r.nombre_comercial ?? r.nombre,
        codigo_barras: r.codigo_barras,
        score: Number(r.score),
      }))

    const [mejor, segundo] = candidatos
    if (mejor && mejor.score! >= 0.75) {
      // Dos casi iguales: mejor que lo mire una persona (minuta 18).
      const empate = !!segundo && mejor.score! - segundo.score! < 0.05
      // El nombre coincide pero el código no: casi seguro es otra
      // presentación u otro laboratorio.
      const otroCodigo = !!f.codigo_barras && !!mejor.codigo_barras && mejor.codigo_barras !== f.codigo_barras
      if (empate || otroCodigo) {
        evaluados.push({
          indice: f.indice, match: 'ambiguo', producto_id: null, candidatos, inactivo: false,
          nota: otroCodigo
            ? `El más parecido es "${mejor.nombre}", pero en el catálogo tiene otro código (${mejor.codigo_barras}).`
            : `Hay dos productos casi idénticos ("${mejor.nombre}" y "${segundo!.nombre}").`,
        })
      } else {
        evaluados.push({ indice: f.indice, match: 'nombre', producto_id: mejor.id, candidatos, inactivo: false, nota: null })
      }
      continue
    }

    evaluados.push({ indice: f.indice, match: 'nuevo', producto_id: null, candidatos, inactivo: false, nota: null })
  }

  return { evaluados }
}

// --------------------------------------------------------------- aplicar ---

/**
 * Carga los lotes contados. TODO en una transacción: si un renglón truena,
 * no queda ninguno cargado y el mensaje dice cuál fue.
 *
 * Por cada renglón:
 *   · el lote ya existe (mismo producto, plaza, lote y ubicación) → ajuste a
 *     lo contado;
 *   · no existe → entrada con lo contado;
 *   · el producto no existe → se da de alta, una sola vez aunque venga en
 *     varios renglones.
 */
export async function aplicarConteo(
  sucursalId: string,
  archivo: string,
  lotes: LoteContado[],
): Promise<{ ok: true; resumen: ResumenCarga } | { ok: false; error: string }> {
  const usuario = usuarioActual()
  if (!usuario) {
    return { ok: false, error: 'Antes de cargar inventario hay que decir quién lo hace. Elige tu nombre arriba y vuelve a intentar.' }
  }
  if (!sucursalId) return { ok: false, error: 'Elige la plaza: el inventario es por plaza.' }
  if (!lotes.length) return { ok: false, error: 'No hay ningún renglón para cargar.' }

  for (const l of lotes) {
    if (!Number.isFinite(Number(l.piezas)) || Number(l.piezas) < 0) {
      return { ok: false, error: `Renglón ${l.renglon}: las piezas no son un número válido.` }
    }
  }

  const motivo = `Conteo de inventario (${archivo})`.slice(0, 200)
  const resumen: ResumenCarga = {
    lotesAjustados: 0, lotesNuevos: 0, sinCambio: 0, enCero: 0, productosNuevos: 0,
    codigosAsignados: 0, reactivados: 0, piezas: 0, omitidos: [],
  }

  try {
    await enTransaccion(async ejecutar => {
      const [plaza] = await ejecutar<{ id: string }>(
        `select id from sucursales where id = $1::uuid`, [sucursalId],
      )
      if (!plaza) throw new Error('Esa plaza ya no existe.')

      const creados = new Map<string, string>()
      const cargados = new Set<string>()

      for (const l of lotes) {
        try {
          const piezas = tresDecimales(Number(l.piezas))
          const lote = l.lote?.trim() || null
          const ubicacion = l.ubicacion?.trim() || null
          const codigo = esCodigoBarras(l.codigo_barras) ? l.codigo_barras : null

          // ---- producto ----------------------------------------------
          let productoId = l.producto_id
          if (!productoId) {
            // Un producto nuevo con 0 piezas no tiene caso darlo de alta.
            if (piezas === 0) { resumen.enCero++; continue }

            const llave = codigo ?? `n:${norm([l.marca, l.nombre].filter(Boolean).join(' '))}`
            productoId = creados.get(llave) ?? null

            if (!productoId && codigo) {
              const [ya] = await ejecutar<{ id: string }>(
                `select id from productos where codigo_barras = $1 order by activo desc limit 1`, [codigo],
              )
              productoId = ya?.id ?? null
            }
            if (!productoId) {
              const nombre = [l.marca, l.nombre].filter(Boolean).join(' ')
              if (!nombre) throw new Error('no trae nombre para darlo de alta.')
              const [nuevo] = await ejecutar<{ id: string }>(
                `insert into productos (nombre, nombre_comercial, nombre_generico, laboratorio, codigo_barras, activo)
                 values ($1, $2, $3, $4, $5, true)
                 returning id`,
                [nombre, l.marca?.trim() || null, l.nombre?.trim() || null, l.laboratorio?.trim() || null, codigo],
              )
              productoId = nuevo.id
              resumen.productosNuevos++
            }
            creados.set(llave, productoId)
          } else if (codigo) {
            // Se reconoció por nombre y en el catálogo no tiene código: se le
            // pone el del Excel, que es lo que hace funcionar la pistola.
            const r = await ejecutar(
              `update productos set codigo_barras = $1, updated_at = now()
                where id = $2::uuid and codigo_barras is null
                  and not exists (select 1 from productos where codigo_barras = $1)
               returning id`,
              [codigo, productoId],
            )
            resumen.codigosAsignados += r.length
          }

          // Dos renglones que caen en el mismo lote (por ejemplo, el mismo
          // producto con dos códigos distintos): el segundo pisaría al primero.
          const llaveLote = [productoId, norm(lote), norm(ubicacion)].join('|')
          if (cargados.has(llaveLote)) {
            resumen.omitidos.push(`Renglón ${l.renglon}: ese producto, lote y ubicación ya venían en otro renglón.`)
            continue
          }
          cargados.add(llaveLote)

          if (piezas > 0) {
            const r = await ejecutar(
              `update productos set activo = true, updated_at = now()
                where id = $1::uuid and not activo
               returning id`,
              [productoId],
            )
            resumen.reactivados += r.length
          }

          // ---- lote --------------------------------------------------
          const [actual] = await ejecutar<{ id: string; existencia: number }>(
            `select id, coalesce(existencia, 0) as existencia
               from inventario
              where producto_id = $1::uuid
                and sucursal_id = $2::uuid
                and coalesce(btrim(lote), '') = coalesce($3, '')
                and upper(coalesce(btrim(ubicacion), '')) = upper(coalesce($4, ''))
              order by existencia desc nulls last
              limit 1
              for update`,
            [productoId, sucursalId, lote, ubicacion],
          )

          if (actual) {
            const diferencia = tresDecimales(piezas - Number(actual.existencia))
            if (diferencia === 0) { resumen.sinCambio++; resumen.piezas += piezas; continue }
            await ejecutar(
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
              [productoId, sucursalId, diferencia, lote, ubicacion, l.caducidad, motivo, usuario, actual.id],
            )
            resumen.lotesAjustados++
          } else if (piezas > 0) {
            await ejecutar(
              `select registrar_movimiento(
                        p_producto_id     => $1::uuid,
                        p_sucursal_id     => $2::uuid,
                        p_cantidad        => $3,
                        p_tipo            => 'entrada',
                        p_lote            => $4,
                        p_ubicacion       => $5,
                        p_caducidad       => $6::date,
                        p_costo_unitario  => null,
                        p_motivo          => $7,
                        p_referencia_tipo => 'manual',
                        p_usuario         => $8)`,
              [productoId, sucursalId, piezas, lote, ubicacion, l.caducidad, motivo, usuario],
            )
            resumen.lotesNuevos++
          } else {
            resumen.enCero++
          }
          resumen.piezas += piezas
        } catch (e) {
          throw new Error(`Renglón ${l.renglon}: ${(e as Error).message}`)
        }
      }
    })
  } catch (e) {
    return { ok: false, error: `${(e as Error).message} No se cargó nada: el archivo entra completo o no entra.` }
  }

  revalidatePath('/inventario')
  revalidatePath('/movimientos')
  revalidatePath('/pos')
  return { ok: true, resumen }
}
