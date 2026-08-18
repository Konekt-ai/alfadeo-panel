// Quién está operando el panel (minuta 8).
//
//   "Todos los usuarios con acceso a la plataforma deben poder realizar
//    movimientos que impacten el mismo inventario en tiempo real."
//
// Lo del inventario compartido y en tiempo real ya se cumple: una sola
// base, y todo movimiento pasa por `registrar_movimiento()`, que bloquea
// el lote. Lo que faltaba era saber QUIÉN lo movió.
//
// Esto NO es autenticación. El panel sigue entrando sin login (decisión
// tomada, ver PENDIENTES.md). Es una firma: la persona se elige una vez,
// se guarda en una cookie y viaja en cada movimiento del kardex. Sirve
// para reclamar un faltante, no para impedir el acceso.
//
// El día que se migre a Supabase Auth, el usuario sale de la sesión y
// `usuarios_panel.auth_uid` amarra el historial ya existente.

import { cookies } from 'next/headers'
import { sql } from './db'
import type { UsuarioPanel } from './types'

export const COOKIE_USUARIO = 'alfadeo_usuario'
export const COOKIE_SUCURSAL = 'alfadeo_sucursal'

const UN_ANIO = 60 * 60 * 24 * 365

/** Nombre de quien opera. `null` si todavía no se ha elegido. */
export function usuarioActual(): string | null {
  return cookies().get(COOKIE_USUARIO)?.value || null
}

/** Plaza en la que se está trabajando. El inventario es por plaza. */
export function sucursalActual(): string | null {
  return cookies().get(COOKIE_SUCURSAL)?.value || null
}

/** Se llama desde una server action; por eso puede escribir la cookie. */
export function fijarUsuario(nombre: string) {
  cookies().set(COOKIE_USUARIO, nombre, { maxAge: UN_ANIO, path: '/', sameSite: 'lax' })
}

export function fijarSucursal(sucursalId: string) {
  cookies().set(COOKIE_SUCURSAL, sucursalId, { maxAge: UN_ANIO, path: '/', sameSite: 'lax' })
}

export async function listarUsuarios(): Promise<UsuarioPanel[]> {
  const { data } = await sql<UsuarioPanel>(
    `select id, nombre, iniciales, rol, sucursal_id, activo
       from usuarios_panel
      where activo
      order by nombre`
  )
  return data
}

/**
 * La plaza con la que trabajar: la de la cookie si es válida, si no la
 * matriz. Nunca devuelve null cuando hay sucursales cargadas, porque una
 * venta sin plaza no se puede registrar.
 */
export async function resolverSucursal(): Promise<{ id: string; clave: string; nombre: string } | null> {
  const { data: sucursales } = await sql<{ id: string; clave: string; nombre: string }>(
    `select id, clave, nombre
       from sucursales
      where activo
      order by es_matriz desc, clave`
  )
  if (!sucursales.length) return null

  const elegida = sucursales.find(s => s.id === sucursalActual()) ?? sucursales[0]
  return { id: elegida.id, clave: elegida.clave, nombre: elegida.nombre }
}
