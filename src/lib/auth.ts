// Puerta de acceso al panel.
//
// POR QUÉ EXISTE: el panel consulta Supabase con la *service role key*, que
// salta todas las políticas RLS. Sin una puerta, cualquiera que dé con la URL
// de Vercel puede ver inventario, clientes, cotizaciones y adeudos completos.
// "Interno" no significa privado si está publicado en internet.
//
// Es una contraseña compartida, no un sistema de usuarios: suficiente para que
// el panel no quede abierto, insuficiente para saber QUIÉN hizo cada cambio.
// Cuando haga falta auditoría por persona, se migra a Supabase Auth.

export const COOKIE_SESION = 'alfadeo_panel'

// 12 horas: cubre una jornada sin obligar a re-capturar a media tarde.
export const DURACION_SESION_SEG = 60 * 60 * 12

/**
 * Deriva el valor de la cookie a partir de la contraseña.
 * Nunca se guarda la contraseña en claro en el navegador.
 *
 * Usa Web Crypto, disponible tanto en el runtime Edge (middleware) como en
 * Node 18+ (route handlers), así que el mismo código sirve en los dos lados.
 */
export async function tokenDeAcceso(password: string): Promise<string> {
  const datos = new TextEncoder().encode(`alfadeo-panel:v1:${password}`)
  const hash = await crypto.subtle.digest('SHA-256', datos)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
