'use server'

// Importación masiva de entradas y salidas (puntos 15 y 9).
//
// Cada renglón pasa por `registrar_movimiento` / `descontar_fefo`, igual que
// una captura a mano: queda en el kardex con firma, lote y existencia antes y
// después. No hay atajos sobre `inventario`.
//
// Contra duplicados (punto 9), dos candados:
//   · La HUELLA del archivo va en el motivo de cada movimiento, entre
//     corchetes. Si ya hay movimientos con esa huella, el archivo ya se
//     aplicó: se avisa con fecha y firma, y sólo se vuelve a aplicar si la
//     persona lo confirma.
//   · Una factura (XML) se reconoce por su UUID: si ya entró por Compras, o
//     es la factura de una venta (cuyas piezas ya salieron al vender), se
//     rechaza. Meterla otra vez movería el inventario dos veces.

import { revalidatePath } from 'next/cache'
import { uno, enTransaccion } from '@/lib/db'
import { usuarioActual } from '@/lib/usuario'

export interface MovImportar {
  renglon: number
  tipo: 'entrada' | 'salida'
  /** Producto elegido en la vista previa. null = darlo de alta (sólo entradas). */
  producto_id: string | null
  codigo_barras: string | null
  marca: string | null
  nombre: string | null
  lote: string | null
  caducidad: string | null
  cantidad: number
  ubicacion: string | null
  costo: number | null
  motivo: string | null
}

export interface ResumenImportacion {
  entradas: number
  salidas: number
  piezasEntraron: number
  piezasSalieron: number
  productosNuevos: number
}

const esCodigoBarras = (s: string | null): boolean => !!s && /^\d{8,14}$/.test(s)
const tresDecimales = (n: number) => Math.round(n * 1000) / 1000
const norm = (v: unknown) =>
  String(v ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

// --------------------------------------------------------------- revisar ---

export interface Revision {
  /** El archivo ya se aplicó: cuándo y quién. */
  aplicado: { fecha: string; usuario: string | null; movimientos: number } | null
  /** La factura ya movió inventario por otro lado. Esto no se puede forzar. */
  bloqueo: string | null
}

async function revisar(huella: string, uuid: string | null): Promise<Revision> {
  if (uuid) {
    const { data: doc } = await uno<{ donde: string; folio: string | null }>(
      `select 'compra' as donde, folio from compras where lower(factura_uuid::text) = lower($1)
       union all
       select 'venta', folio from ventas where lower(factura_uuid::text) = lower($1)
       limit 1`,
      [uuid]
    )
    if (doc) {
      return {
        aplicado: null,
        bloqueo: doc.donde === 'compra'
          ? `Esta factura ya entró al inventario por la compra ${doc.folio ?? ''}. Cargarla aquí metería las piezas dos veces.`
          : `Esta es la factura de la venta ${doc.folio ?? ''}: sus piezas ya salieron al vender. Cargarla aquí las sacaría dos veces.`,
      }
    }
  }

  const { data } = await uno<{ fecha: string | null; usuario: string | null; movimientos: number }>(
    `select min(created_at)::text as fecha, min(usuario) as usuario, count(*)::int as movimientos
       from movimientos_inventario
      where motivo like '%[' || $1 || ']%'`,
    [huella]
  )
  return {
    aplicado: data && data.movimientos > 0
      ? { fecha: data.fecha ?? '', usuario: data.usuario, movimientos: data.movimientos }
      : null,
    bloqueo: null,
  }
}

/** Para la vista previa: ¿ya se aplicó este archivo o esta factura? */
export async function revisarImportacion(huella: string, uuid: string | null): Promise<Revision> {
  return revisar(huella, uuid)
}

// --------------------------------------------------------------- aplicar ---

/**
 * Aplica los movimientos. TODO en una transacción: si un renglón truena (una
 * salida sin existencia suficiente, un lote que no existe), no se aplica
 * ninguno y el mensaje dice cuál fue.
 */
export async function aplicarImportacion(input: {
  sucursalId: string
  archivo: string
  huella: string
  uuid: string | null
  movimientos: MovImportar[]
  /** La persona confirmó que sí quiere aplicar otra vez un archivo ya aplicado. */
  aunqueYaAplicado?: boolean
}): Promise<{ ok: true; resumen: ResumenImportacion } | { ok: false; error: string }> {
  const usuario = usuarioActual()
  if (!usuario) {
    return { ok: false, error: 'Antes de mover inventario hay que decir quién lo hace. Elige tu nombre arriba y vuelve a intentar.' }
  }
  if (!input.sucursalId) return { ok: false, error: 'Elige la plaza: el inventario es por plaza.' }
  if (!input.movimientos.length) return { ok: false, error: 'No hay ningún renglón para aplicar.' }
  if (!/^[0-9A-F-]{8,40}$/i.test(input.huella)) return { ok: false, error: 'El archivo no trae huella válida. Vuelve a cargarlo.' }

  // Se revisa otra vez aquí y no sólo en la vista previa: entre una y otra
  // alguien pudo haber aplicado el mismo archivo.
  const rev = await revisar(input.huella, input.uuid)
  if (rev.bloqueo) return { ok: false, error: rev.bloqueo }
  if (rev.aplicado && !input.aunqueYaAplicado) {
    return { ok: false, error: 'Este archivo ya se aplicó antes. Confirma en la vista previa si de verdad va otra vez.' }
  }

  for (const m of input.movimientos) {
    if (!Number.isFinite(Number(m.cantidad)) || Number(m.cantidad) <= 0) {
      return { ok: false, error: `Renglón ${m.renglon}: la cantidad no es válida.` }
    }
    if (m.tipo !== 'entrada' && m.tipo !== 'salida') {
      return { ok: false, error: `Renglón ${m.renglon}: falta decir si es entrada o salida.` }
    }
  }

  // La huella entre corchetes es lo que se busca para saber si ya se aplicó.
  const pie = `Importación ${input.archivo} [${input.huella}]`
  const resumen: ResumenImportacion = { entradas: 0, salidas: 0, piezasEntraron: 0, piezasSalieron: 0, productosNuevos: 0 }

  try {
    await enTransaccion(async ejecutar => {
      const [plaza] = await ejecutar<{ id: string }>(`select id from sucursales where id = $1::uuid`, [input.sucursalId])
      if (!plaza) throw new Error('Esa plaza ya no existe.')

      const creados = new Map<string, string>()

      for (const m of input.movimientos) {
        try {
          const cantidad = tresDecimales(Number(m.cantidad))
          const lote = m.lote?.trim() || null
          const ubicacion = m.ubicacion?.trim().toUpperCase() || null
          const motivo = (m.motivo ? `${m.motivo.trim()} · ${pie}` : pie).slice(0, 300)
          const codigo = esCodigoBarras(m.codigo_barras) ? m.codigo_barras : null

          // ---- producto ----------------------------------------------
          let productoId = m.producto_id
          if (!productoId) {
            if (m.tipo === 'salida') throw new Error('no se puede sacar un producto que no está en el catálogo.')
            const llave = codigo ?? `n:${norm([m.marca, m.nombre].filter(Boolean).join(' '))}`
            productoId = creados.get(llave) ?? null
            if (!productoId && codigo) {
              const [ya] = await ejecutar<{ id: string }>(
                `select id from productos where codigo_barras = $1 order by activo desc limit 1`, [codigo],
              )
              productoId = ya?.id ?? null
            }
            if (!productoId) {
              const nombre = [m.marca, m.nombre].filter(Boolean).join(' ')
              if (!nombre) throw new Error('no trae nombre para darlo de alta.')
              const [nuevo] = await ejecutar<{ id: string }>(
                `insert into productos (nombre, nombre_comercial, nombre_generico, codigo_barras, activo)
                 values ($1, $2, $3, $4, true) returning id`,
                [nombre, m.marca?.trim() || null, m.nombre?.trim() || null, codigo],
              )
              productoId = nuevo.id
              resumen.productosNuevos++
            }
            creados.set(llave, productoId)
          }

          // ---- lote --------------------------------------------------
          // Mismo lote = mismo producto, plaza, lote y ubicación. En una
          // salida sin ubicación basta con el lote.
          const buscarLote = async (conUbicacion: boolean) => {
            const [fila] = await ejecutar<{ id: string; existencia: number; caducidad: string | null; ubicacion: string | null }>(
              `select id, coalesce(existencia, 0) as existencia, caducidad::text, ubicacion
                 from inventario
                where producto_id = $1::uuid
                  and sucursal_id = $2::uuid
                  and coalesce(btrim(lote), '') = coalesce($3, '')
                  ${conUbicacion ? `and upper(coalesce(btrim(ubicacion), '')) = upper(coalesce($4, ''))` : ''}
                order by existencia desc
                limit 1
                for update`,
              conUbicacion ? [productoId, input.sucursalId, lote, ubicacion] : [productoId, input.sucursalId, lote],
            )
            return fila ?? null
          }

          if (m.tipo === 'entrada') {
            const actual = await buscarLote(true)
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
                        p_usuario         => $9,
                        p_inventario_id   => $10::uuid)`,
              [productoId, input.sucursalId, cantidad, lote, ubicacion,
               m.caducidad ?? actual?.caducidad ?? null, m.costo, motivo, usuario, actual?.id ?? null],
            )
            resumen.entradas++
            resumen.piezasEntraron += cantidad
            continue
          }

          // Salida con lote: sale de ese lote. Sin lote: el que caduca primero.
          if (lote) {
            const actual = (ubicacion ? await buscarLote(true) : null) ?? await buscarLote(false)
            if (!actual) throw new Error(`no hay lote ${lote}${ubicacion ? ` en ${ubicacion}` : ''} de ese producto en la plaza.`)
            await ejecutar(
              `select registrar_movimiento(
                        p_producto_id     => $1::uuid,
                        p_sucursal_id     => $2::uuid,
                        p_cantidad        => $3,
                        p_tipo            => 'salida',
                        p_lote            => $4,
                        p_ubicacion       => $5,
                        p_caducidad       => $6::date,
                        p_motivo          => $7,
                        p_referencia_tipo => 'manual',
                        p_usuario         => $8,
                        p_inventario_id   => $9::uuid)`,
              [productoId, input.sucursalId, -cantidad, lote, actual.ubicacion, actual.caducidad, motivo, usuario, actual.id],
            )
          } else {
            await ejecutar(
              `select descontar_fefo(
                        p_producto_id     => $1::uuid,
                        p_sucursal_id     => $2::uuid,
                        p_cantidad        => $3,
                        p_tipo            => 'salida',
                        p_motivo          => $4,
                        p_referencia_tipo => 'manual',
                        p_usuario         => $5)`,
              [productoId, input.sucursalId, cantidad, motivo, usuario],
            )
          }
          resumen.salidas++
          resumen.piezasSalieron += cantidad
        } catch (e) {
          throw new Error(`Renglón ${m.renglon}: ${(e as Error).message}`)
        }
      }
    })
  } catch (e) {
    return { ok: false, error: `${(e as Error).message} No se aplicó nada: el archivo entra completo o no entra.` }
  }

  revalidatePath('/movimientos')
  revalidatePath('/inventario')
  revalidatePath('/pos')
  return { ok: true, resumen }
}
