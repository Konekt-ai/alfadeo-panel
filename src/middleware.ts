import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { COOKIE_SESION, tokenDeAcceso } from '@/lib/auth'

// Rutas que tienen que responder sin sesión, o no habría forma de iniciarla.
const RUTAS_ABIERTAS = ['/login', '/api/login']

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (RUTAS_ABIERTAS.some((r) => pathname === r || pathname.startsWith(r + '/'))) {
    return NextResponse.next()
  }

  const password = process.env.PANEL_PASSWORD

  if (!password) {
    // En local se deja pasar: pedir contraseña para desarrollar estorba.
    if (process.env.NODE_ENV !== 'production') return NextResponse.next()

    // En producción NO. El panel lee la base completa con la service role key;
    // publicarlo sin puerta es exponer clientes, inventario y adeudos a
    // cualquiera que dé con la URL. Mejor que no cargue a que cargue abierto.
    return new NextResponse(
      `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Panel ALFA-DEO — falta configurar</title></head>
<body style="font-family:system-ui,sans-serif;max-width:34rem;margin:15vh auto;padding:0 1.5rem;color:#1f2937;line-height:1.6">
  <h1 style="color:#003366;font-size:1.5rem">Falta configurar el acceso</h1>
  <p>Este panel consulta la base de datos completa, así que no se publica sin contraseña.</p>
  <p>En Vercel: <strong>Settings → Environment Variables</strong>, agrega
     <code style="background:#f3f4f6;padding:.15rem .4rem;border-radius:.25rem">PANEL_PASSWORD</code>
     y vuelve a desplegar.</p>
</body></html>`,
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }

  const cookie = req.cookies.get(COOKIE_SESION)?.value
  if (cookie && cookie === (await tokenDeAcceso(password))) {
    return NextResponse.next()
  }

  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.search = ''
  // Para regresarlo a donde iba después de entrar.
  if (pathname !== '/') url.searchParams.set('destino', pathname)
  return NextResponse.redirect(url)
}

export const config = {
  // Todo menos los archivos estáticos de Next y el favicon.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.svg$).*)'],
}
