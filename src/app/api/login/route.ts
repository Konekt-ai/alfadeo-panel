import { NextResponse } from 'next/server'
import { COOKIE_SESION, DURACION_SESION_SEG, tokenDeAcceso } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/** Sólo se aceptan destinos internos: evita que ?destino= mande a otro sitio. */
function destinoSeguro(valor: unknown): string {
  const s = typeof valor === 'string' ? valor : ''
  if (!s.startsWith('/') || s.startsWith('//')) return '/solicitudes'
  return s
}

export async function POST(req: Request) {
  const form = await req.formData()
  const capturada = String(form.get('password') ?? '')
  const esperada = process.env.PANEL_PASSWORD

  if (!esperada) {
    return NextResponse.json(
      { error: 'Falta configurar PANEL_PASSWORD en el servidor.' },
      { status: 503 }
    )
  }

  // Se comparan los hashes, no las cadenas: ambos miden lo mismo, así que la
  // comparación no filtra la longitud de la contraseña.
  const [tokenCapturado, tokenEsperado] = await Promise.all([
    tokenDeAcceso(capturada),
    tokenDeAcceso(esperada),
  ])

  if (tokenCapturado !== tokenEsperado) {
    return NextResponse.redirect(new URL('/login?error=1', req.url), { status: 303 })
  }

  const res = NextResponse.redirect(
    new URL(destinoSeguro(form.get('destino')), req.url),
    { status: 303 }
  )

  res.cookies.set(COOKIE_SESION, tokenEsperado, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: DURACION_SESION_SEG,
  })

  return res
}
