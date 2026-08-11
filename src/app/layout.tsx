import type { Metadata } from 'next'
import './globals.css'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import { supabase } from '@/lib/supabase'
import { usuarioActual, sucursalActual } from '@/lib/usuario'
import type { UsuarioPanel } from '@/lib/types'

export const metadata: Metadata = {
  title: 'Panel ALFA-DEO',
  description: 'Panel interno de gestión comercial',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Si la migración de operación todavía no se corrió, `usuarios_panel` no
  // existe. El header no debe tumbar el panel entero por eso: se queda sin
  // selector de usuario y ya.
  const [{ data: usuarios }, { data: sucursales }] = await Promise.all([
    supabase.from('usuarios_panel')
      .select('id, nombre, iniciales, rol, sucursal_id, activo')
      .eq('activo', true).order('nombre'),
    supabase.from('sucursales')
      .select('id, clave, nombre')
      .eq('activo', true).order('es_matriz', { ascending: false }),
  ])

  return (
    <html lang="es">
      <body className="bg-gray-50 min-h-screen flex flex-col">
        <Header
          usuarios={(usuarios ?? []) as UsuarioPanel[]}
          sucursales={sucursales ?? []}
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
