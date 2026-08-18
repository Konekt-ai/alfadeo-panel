'use server'

// Traslados entre plazas (minuta 9 y 37).
//
// Guadalajara y Monterrey son empresas independientes del mismo dueño y
// MTY se surte de GDL. Hoy mover mercancía se captura dos veces: la
// salida en una plaza y la entrada en la otra.
//
// Aquí un traslado es UN documento que produce DOS movimientos: la
// salida en origen (FEFO, al enviar) y la entrada en destino con el
// MISMO lote y la misma caducidad (al recibir). Toda la lógica de
// inventario vive en los RPC `enviar_traslado` y `recibir_traslado`;
// este archivo sólo arma el documento y devuelve los errores de
// Postgres tal cual para pintarlos en pantalla.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { sql, qx, enTransaccion } from '@/lib/db'
import { usuarioActual } from '@/lib/usuario'
import type { ProductoPOS } from '@/lib/types'

// Los tipos van sin `export` a propósito: un archivo 'use server' sólo
// puede exportar funciones async. Se usan en las firmas de abajo, así que
// el cliente los infiere solo al llamar a la acción.

// Una línea del traslado antes de guardarla. El lote NO se elige a mano:
// lo decide `descontar_fefo` al enviar, y se guarda en traslado_items.lotes.
interface PartidaTraslado {
  producto_id: string
  cantidad: number
}

interface DatosTraslado {
  origen_id: string
  destino_id: string
  paqueteria: string
  guia: string
  fecha_estimada: string // 'YYYY-MM-DD'
  notas: string
  enviar_ahora: boolean
  partidas: PartidaTraslado[]
}

type ResultadoTraslado =
  // `aviso` = el traslado sí se creó, pero el envío inmediato falló
  // (por ejemplo, existencia insuficiente). Queda en borrador.
  | { ok: true; id: string; folio: string | null; aviso?: string }
  | { ok: false; error: string }

/**
 * Buscador de producto del alta. Usa el mismo RPC que el punto de venta,
 * pero amarrado a la PLAZA DE ORIGEN: la existencia y los lotes que
 * devuelve son los de la plaza que envía, que es lo único que se puede
 * trasladar (minuta 28).
 */
export async function buscarProductosTraslado(
  q: string,
  origenId: string,
): Promise<{ productos: ProductoPOS[]; error?: string }> {
  const texto = (q ?? '').trim()
  if (!origenId || texto.length < 2) return { productos: [] }

  const { data, error } = await sql<ProductoPOS>(
    `select * from buscar_productos_pos($1, $2::uuid, $3)`,
    [texto, origenId, 12]
  )

  if (error) return { productos: [], error: error.message }
  return { productos: data }
}

/**
 * Alta del traslado: folio por plaza de origen, encabezado y partidas.
 * Nace en 'borrador' —todavía no mueve inventario— y sólo se descuenta
 * si el usuario pide enviarlo ya.
 */
export async function crearTraslado(datos: DatosTraslado): Promise<ResultadoTraslado> {
  const usuario = usuarioActual()

  if (!datos.origen_id || !datos.destino_id) {
    return { ok: false, error: 'Elige la plaza que envía y la que recibe.' }
  }
  // El RPC y el CHECK de la tabla también lo rechazan; se avisa antes
  // para no gastar un folio en un documento imposible.
  if (datos.origen_id === datos.destino_id) {
    return { ok: false, error: 'El origen y el destino tienen que ser plazas distintas.' }
  }

  const partidas = (datos.partidas ?? []).filter(
    p => p.producto_id && Number(p.cantidad) > 0,
  )
  if (partidas.length === 0) {
    return { ok: false, error: 'Agrega al menos una partida con cantidad mayor a cero.' }
  }

  // Folio, encabezado y partidas en UNA transacción: si algo truena no
  // queda un traslado vacío con folio consumido. Antes había que borrar el
  // encabezado a mano cuando fallaban las partidas.
  let trasladoId: string
  let folioNuevo: string | null
  try {
    const r = await enTransaccion(async ejecutar => {
      // Folio consecutivo de la plaza que envía: cada empresa lleva su
      // propia serie (minuta 9).
      const [{ folio }] = await ejecutar<{ folio: string | null }>(
        `select siguiente_folio('traslado', $1::uuid) as folio`,
        [datos.origen_id]
      )

      const [cab] = await ejecutar<{ id: string; folio: string | null }>(
        `insert into traslados (folio, origen_id, destino_id, estado,
                                paqueteria, guia, fecha_estimada, usuario, notas)
         values ($1, $2::uuid, $3::uuid, 'borrador', $4, $5, $6::date, $7, $8)
         returning id, folio`,
        [
          folio,
          datos.origen_id,
          datos.destino_id,
          datos.paqueteria || null,
          datos.guia?.trim() || null,
          datos.fecha_estimada || null,
          usuario,
          datos.notas?.trim() || null,
        ]
      )

      // unnest en vez de un insert por partida: un solo viaje a la base.
      await ejecutar(
        `insert into traslado_items (traslado_id, producto_id, cantidad, posicion)
         select $1::uuid, u.producto_id::uuid, u.cantidad, u.posicion
           from unnest($2::text[], $3::numeric[], $4::int[])
                as u(producto_id, cantidad, posicion)`,
        [
          cab.id,
          partidas.map(p => p.producto_id),
          partidas.map(p => Number(p.cantidad)),
          partidas.map((_, i) => i),
        ]
      )

      return cab
    })
    trasladoId = r.id
    folioNuevo = r.folio
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }

  let aviso: string | undefined
  if (datos.enviar_ahora) {
    try {
      await qx(`select enviar_traslado($1::uuid, $2)`, [trasladoId, usuario])
    } catch (e) {
      // El documento ya existe: si el envío falla se queda en borrador y
      // se puede reintentar desde el detalle.
      aviso = (e as Error).message
    }
  }

  revalidatePath('/traslados')
  revalidatePath('/inventario')

  return {
    ok: true,
    id: trasladoId,
    folio: folioNuevo,
    aviso,
  }
}

/**
 * Envío: descuenta en la plaza de origen por FEFO y deja el traslado en
 * tránsito. Los lotes de los que salió quedan guardados en cada partida.
 */
export async function enviarTrasladoAccion(form: FormData): Promise<void> {
  const id = String(form.get('traslado_id') ?? '')
  if (!id) redirect('/traslados')

  let error: { message: string } | null = null
  try {
    await qx(`select enviar_traslado($1::uuid, $2)`, [id, usuarioActual()])
  } catch (e) {
    error = { message: (e as Error).message }
  }

  revalidatePath('/traslados')
  revalidatePath(`/traslados/${id}`)
  revalidatePath('/inventario')

  // El error del RPC viaja en la URL para pintarlo tal cual en el detalle.
  redirect(`/traslados/${id}${error ? `?error=${encodeURIComponent(error.message)}` : ''}`)
}

/**
 * Recepción: da entrada en la plaza de destino con el MISMO lote y la
 * misma caducidad con que salió. Éste es el punto entero de la minuta 37:
 * un solo documento, dos movimientos, sin recapturar nada.
 */
export async function recibirTrasladoAccion(form: FormData): Promise<void> {
  const id = String(form.get('traslado_id') ?? '')
  const ubicacion = String(form.get('ubicacion') ?? '').trim()
  if (!id) redirect('/traslados')

  if (!ubicacion) {
    redirect(
      `/traslados/${id}?error=${encodeURIComponent(
        'Elige en qué ubicación de destino se guarda la mercancía.',
      )}`,
    )
  }

  let error: { message: string } | null = null
  try {
    await qx(`select recibir_traslado($1::uuid, $2, $3)`, [id, usuarioActual(), ubicacion])
  } catch (e) {
    error = { message: (e as Error).message }
  }

  revalidatePath('/traslados')
  revalidatePath(`/traslados/${id}`)
  revalidatePath('/inventario')

  redirect(`/traslados/${id}${error ? `?error=${encodeURIComponent(error.message)}` : ''}`)
}

/**
 * Cancelar sólo tiene sentido en borrador: en ese estado no se ha movido
 * ni una pieza. Ya en tránsito la mercancía está fuera del almacén y el
 * ajuste tiene que hacerse a mano en el kardex.
 */
export async function cancelarTrasladoAccion(form: FormData): Promise<void> {
  const id = String(form.get('traslado_id') ?? '')
  if (!id) redirect('/traslados')

  let mensaje: string | null = null
  try {
    const filas = await qx<{ id: string }>(
      `update traslados set estado = 'cancelado'
        where id = $1::uuid and estado = 'borrador'
        returning id`,
      [id]
    )
    if (filas.length === 0) mensaje = 'Sólo se puede cancelar un traslado en borrador.'
  } catch (e) {
    mensaje = (e as Error).message
  }

  revalidatePath('/traslados')
  revalidatePath(`/traslados/${id}`)

  redirect(`/traslados/${id}${mensaje ? `?error=${encodeURIComponent(mensaje)}` : ''}`)
}
