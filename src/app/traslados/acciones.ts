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
import { supabase } from '@/lib/supabase'
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

  const { data, error } = await supabase.rpc('buscar_productos_pos', {
    q: texto,
    p_sucursal: origenId,
    limite: 12,
  })

  if (error) return { productos: [], error: error.message }
  return { productos: (data ?? []) as ProductoPOS[] }
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

  // Folio consecutivo de la plaza que envía: cada empresa lleva su
  // propia serie (minuta 9).
  const { data: folio, error: errorFolio } = await supabase.rpc('siguiente_folio', {
    p_ambito: 'traslado',
    p_sucursal_id: datos.origen_id,
  })
  if (errorFolio) return { ok: false, error: errorFolio.message }

  const { data: traslado, error: errorAlta } = await supabase
    .from('traslados')
    .insert({
      folio: folio ?? null,
      origen_id: datos.origen_id,
      destino_id: datos.destino_id,
      estado: 'borrador',
      paqueteria: datos.paqueteria || null,
      guia: datos.guia?.trim() || null,
      fecha_estimada: datos.fecha_estimada || null,
      usuario,
      notas: datos.notas?.trim() || null,
    })
    .select('id, folio')
    .single()

  if (errorAlta || !traslado) {
    return { ok: false, error: errorAlta?.message ?? 'No se pudo crear el traslado.' }
  }

  const trasladoId = String(traslado.id)

  const { error: errorPartidas } = await supabase.from('traslado_items').insert(
    partidas.map((p, i) => ({
      traslado_id: trasladoId,
      producto_id: p.producto_id,
      cantidad: Number(p.cantidad),
      posicion: i,
    })),
  )

  if (errorPartidas) {
    // Un traslado sin partidas no sirve para nada: se deshace el
    // encabezado para no dejar documentos vacíos en la lista.
    await supabase.from('traslados').delete().eq('id', trasladoId)
    return { ok: false, error: errorPartidas.message }
  }

  let aviso: string | undefined
  if (datos.enviar_ahora) {
    const { error: errorEnvio } = await supabase.rpc('enviar_traslado', {
      p_traslado_id: trasladoId,
      p_usuario: usuario,
    })
    // El documento ya existe: si el envío falla se queda en borrador y
    // se puede reintentar desde el detalle.
    if (errorEnvio) aviso = errorEnvio.message
  }

  revalidatePath('/traslados')
  revalidatePath('/inventario')

  return {
    ok: true,
    id: trasladoId,
    folio: (traslado.folio as string | null) ?? null,
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

  const { error } = await supabase.rpc('enviar_traslado', {
    p_traslado_id: id,
    p_usuario: usuarioActual(),
  })

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

  const { error } = await supabase.rpc('recibir_traslado', {
    p_traslado_id: id,
    p_usuario: usuarioActual(),
    p_ubicacion: ubicacion,
  })

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

  const { data, error } = await supabase
    .from('traslados')
    .update({ estado: 'cancelado' })
    .eq('id', id)
    .eq('estado', 'borrador')
    .select('id')

  const mensaje = error
    ? error.message
    : (data ?? []).length === 0
      ? 'Sólo se puede cancelar un traslado en borrador.'
      : null

  revalidatePath('/traslados')
  revalidatePath(`/traslados/${id}`)

  redirect(`/traslados/${id}${mensaje ? `?error=${encodeURIComponent(mensaje)}` : ''}`)
}
