import type { Metadata } from 'next'
import './globals.css'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import { sql } from '@/lib/db'
import { usuarioActual, sucursalActual } from '@/lib/usuario'
import type { UsuarioPanel } from '@/lib/types'

export const metadata: Metadata = {
  title: 'Panel ALFA-DEO',
  description: 'Panel interno de gestión comercial',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Si la base todavía no está preparada, `usuarios_panel` no existe. El
  // header no debe tumbar el panel entero por eso: `q` no lanza, así que se
  // queda sin selector de usuario y ya.
  const [{ data: usuarios }, { data: sucursales }] = await Promise.all([
    sql<UsuarioPanel>(
      `select id, nombre, iniciales, rol, sucursal_id, activo
         from usuarios_panel
        where activo
        order by nombre`
    ),
    sql<{ id: string; clave: string; nombre: string }>(
      `select id, clave, nombre
         from sucursales
        where activo
        order by es_matriz desc, clave`
    ),
  ])

  return (
    <html lang="es">
      <body className="bg-gray-50 min-h-screen flex flex-col">
        <Header
          usuarios={usuarios}
          sucursales={sucursales}
          usuario={usuarioActual()}
          sucursalId={sucursalActual()}
        />
        <div className="flex flex-1 min-h-0">
          <Sidebar />
          <main className="flex-1 overflow-auto pb-20 md:pb-0">
            {children}
          </main>
        </div>
      </body>
    </html>
  )
}
