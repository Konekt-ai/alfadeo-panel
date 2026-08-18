'use server'

// Importador del catálogo de Aspel (minuta 22, 25).
//
//   "En Aspel ya tienen cargados los códigos de barras. Desean aprovecharlos
//    para que el Punto de Venta facture mediante escaneo."
//
// `productos.codigo_barras` está vacío hoy; sin él, la pistola del POS no
// sirve. Esto es lo que lo llena.
//
// Regla importante: **aquí NO se tocan existencias.** Las existencias entran
// por movimientos de inventario, que dejan kardex y firma (minuta 8, 10). Una
// importación que pisara existencias borraría ese rastro sin dejar asiento.

import { revalidatePath } from 'next/cache'
import { sql, qx } from '@/lib/db'
import type { ProductoPOS } from '@/lib/types'

export interface FilaAspel {
  codigo_barras: string | null
  clave: string | null
  descripcion: string | null
  precio: number | null
  laboratorio: string | null
}

export type TipoMatch = 'codigo' | 'nombre' | 'nuevo' | 'ambiguo'

export interface FilaEvaluada extends FilaAspel {
  indice: number
  match: TipoMatch
  producto_id: string | null
  producto_nombre: string | null
  // Sólo cuando el match fue por nombre: qué tan seguro es.
  score: number | null
  nota: string | null
}

const limpio = (v: unknown): string | null => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

// Un EAN/GTIN válido tiene entre 8 y 14 dígitos. Lo que no cumpla eso es la
// clave interna de Aspel, no un código de barras, y guardarla ahí rompería
// el escaneo.
const esCodigoBarras = (s: string | null): boolean => !!s && /^\d{8,14}$/.test(s)

/**
 * Compara cada fila del archivo contra el catálogo y dice qué va a pasar con
 * ella. No escribe nada: es la vista previa que el usuario aprueba.
 */
export async function evaluarFilas(filas: FilaAspel[]): Promise<{ evaluadas: FilaEvaluada[]; error?: string }> {
  const evaluadas: FilaEvaluada[] = []

  // (a) Match duro por código de barras, en un solo viaje.
  const codigos = filas.map(f => f.codigo_barras).filter(esCodigoBarras) as string[]
  const porCodigo = new Map<string, { id: string; nombre: string }>()
  if (codigos.length) {
    const { data, error } = await sql<{
      id: string; nombre: string; nombre_comercial: string | null; codigo_barras: string | null
    }>(
      `select id, nombre, nombre_comercial, codigo_barras
         from productos where codigo_barras = any($1)`,
      [Array.from(new Set(codigos))]
    )
    if (error) return { evaluadas: [], error: error.message }
    for (const p of data) {
      if (p.codigo_barras) {
        porCodigo.set(p.codigo_barras, { id: p.id, nombre: p.nombre_comercial ?? p.nombre })
      }
    }
  }

  // (b) Match por clave de Aspel, si alguna vez se guardó en producto_codigos.
  const claves = filas.map(f => f.clave).filter(Boolean) as string[]
  const porClave = new Map<string, string>()
  if (claves.length) {
    const { data } = await sql<{ producto_id: string; codigo: string }>(
      `select producto_id, codigo from producto_codigos where codigo = any($1)`,
      [Array.from(new Set(claves))]
    )
    for (const c of data) porClave.set(c.codigo, c.producto_id)
  }

  for (let i = 0; i < filas.length; i++) {
    const f = filas[i]
    const base = { ...f, indice: i, producto_id: null as string | null, producto_nombre: null as string | null, score: null as number | null, nota: null as string | null }

    if (!f.descripcion && !f.codigo_barras && !f.clave) {
      evaluadas.push({ ...base, match: 'ambiguo', nota: 'Fila vacía.' })
      continue
    }

    // El código de barras manda: es exacto.
    if (esCodigoBarras(f.codigo_barras)) {
      const p = porCodigo.get(f.codigo_barras!)
      if (p) {
        evaluadas.push({ ...base, match: 'codigo', producto_id: p.id, producto_nombre: p.nombre })
        continue
      }
    } else if (f.codigo_barras) {
      base.nota = `"${f.codigo_barras}" no parece un código de barras (deben ser 8 a 14 dígitos); se ignora.`
      base.codigo_barras = null
    }

    if (f.clave && porClave.has(f.clave)) {
      const id = porClave.get(f.clave)!
      evaluadas.push({ ...base, match: 'codigo', producto_id: id, producto_nombre: null, nota: base.nota ?? 'Ligado por la clave de Aspel.' })
      continue
    }

    // Por nombre. Se pide el ranking del RPC, que ya pondera comercial sobre
    // genérico (minuta 20).
    if (f.descripcion) {
      const { data: rs } = await sql<ProductoPOS>(
        `select * from buscar_productos_pos($1, null, 2)`,
        [f.descripcion]
      )
      const mejor = rs[0]
      const segundo = rs[1]

      if (mejor && Number(mejor.score) >= 0.75) {
        // Dos candidatos casi iguales: mejor que lo mire una persona. Con
        // presentaciones distintas del mismo miligramaje esto pasa seguido
        // (minuta 18).
        const empate = segundo && Number(mejor.score) - Number(segundo.score) < 0.05
        evaluadas.push({
          ...base,
          match: empate ? 'ambiguo' : 'nombre',
          producto_id: empate ? null : mejor.producto_id,
          producto_nombre: mejor.nombre_comercial ?? mejor.nombre,
          score: Number(mejor.score),
          nota: empate
            ? `Hay dos productos casi idénticos ("${mejor.nombre_comercial ?? mejor.nombre}" y "${segundo!.nombre_comercial ?? segundo!.nombre}").`
            : base.nota,
        })
        continue
      }
    }

    evaluadas.push({ ...base, match: 'nuevo' })
  }

  return { evaluadas }
}

export interface OpcionesImportacion {
  // Actualizar el código de barras de los productos que hicieron match.
  actualizarCodigos: boolean
  // Actualizar también el precio de venta.
  actualizarPrecios: boolean
  // Dar de alta los que no existen.
  crearNuevos: boolean
}

export interface ResumenImportacion {
  actualizados: number
  creados: number
  omitidos: number
  errores: string[]
}

/**
 * Aplica lo aprobado. Se procesa en tandas para no reventar el tamaño de la
 * petición con catálogos grandes.
 */
export async function aplicarImportacion(
  filas: FilaEvaluada[],
  opciones: OpcionesImportacion,
): Promise<{ ok: true; resumen: ResumenImportacion } | { ok: false; error: string }> {
  const resumen: ResumenImportacion = { actualizados: 0, creados: 0, omitidos: 0, errores: [] }

  const conMatch = filas.filter(f => f.producto_id && (f.match === 'codigo' || f.match === 'nombre'))
  const nuevos = filas.filter(f => f.match === 'nuevo' && f.descripcion)

  // --- Actualizaciones -------------------------------------------------
  if (opciones.actualizarCodigos || opciones.actualizarPrecios) {
    for (const f of conMatch) {
      const cambios: Record<string, unknown> = {}
      if (opciones.actualizarCodigos && esCodigoBarras(f.codigo_barras)) {
        cambios.codigo_barras = f.codigo_barras
      }
      if (opciones.actualizarPrecios && f.precio !== null && f.precio > 0) {
        cambios.precio_base = f.precio
      }
      if (!Object.keys(cambios).length) { resumen.omitidos++; continue }

      // Las columnas se arman a partir del objeto `cambios`, que ya sólo
      // trae lo que el usuario pidió actualizar.
      const cols = Object.keys(cambios)
      const sets = cols.map((c, i) => `${c} = $${i + 1}`).join(', ')
      try {
        await qx(
          `update productos set ${sets} where id = $${cols.length + 1}::uuid`,
          [...cols.map(c => cambios[c]), f.producto_id!]
        )
        resumen.actualizados++
      } catch (e) {
        // El código de barras es único de facto: si ya lo tiene otro producto,
        // hay que decir cuál fila falló, no fallar en silencio.
        resumen.errores.push(`Fila ${f.indice + 2}: ${(e as Error).message}`)
      }
    }
  } else {
    resumen.omitidos += conMatch.length
  }

  // --- Altas ------------------------------------------------------------
  if (opciones.crearNuevos && nuevos.length) {
    // De 200 en 200: el catálogo completo de Aspel puede traer miles.
    for (let i = 0; i < nuevos.length; i += 200) {
      const tanda = nuevos.slice(i, i + 200)
      // El trigger `productos_derivar_nombre` desglosa comercial, genérico,
      // concentración y presentación a partir del nombre (minuta 17).
      try {
        const data = await qx<{ id: string }>(
          `insert into productos (nombre, codigo_barras, laboratorio, precio_base, activo)
           select u.nombre, u.codigo_barras, u.laboratorio, u.precio_base, true
             from unnest($1::text[], $2::text[], $3::text[], $4::numeric[])
                  as u(nombre, codigo_barras, laboratorio, precio_base)
           returning id`,
          [
            tanda.map(f => f.descripcion),
            tanda.map(f => (esCodigoBarras(f.codigo_barras) ? f.codigo_barras : null)),
            tanda.map(f => f.laboratorio),
            tanda.map(f => f.precio),
          ]
        )
        resumen.creados += data.length
      } catch (e) {
        resumen.errores.push(`Filas ${i + 2}–${i + tanda.length + 1}: ${(e as Error).message}`)
      }
    }
  } else {
    resumen.omitidos += nuevos.length
  }

  revalidatePath('/inventario')
  return { ok: true, resumen }
}
