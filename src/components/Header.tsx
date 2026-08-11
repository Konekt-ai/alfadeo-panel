// Header del panel: logo + quién opera y en qué plaza.
//
// Recibe los datos ya cargados en vez de leerlos aquí. Es a propósito:
// un componente async dentro de JSX obliga a pelear con los tipos de
// React 18, y el layout ya es async de todos modos.

import Image from 'next/image'
import BarraSesion from './BarraSesion'
import type { UsuarioPanel, Sucursal } from '@/lib/types'

export default function Header({
  usuarios,
  sucursales,
  usuario,
  sucursalId,
}: {
  usuarios: UsuarioPanel[]
  sucursales: Pick<Sucursal, 'id' | 'clave' | 'nombre'>[]
  usuario: string | null
  sucursalId: string | null
}) {
  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center px-4 md:px-6 shrink-0 gap-3">
      <Image src="/logo.png" alt="ALFA-DEO" width={120} height={40} className="object-contain" priority />
      <div className="ml-1 pl-3 border-l border-gray-200 text-xs text-gray-400 font-medium uppercase tracking-wider hidden sm:block">
        Panel interno
      </div>
      <div className="ml-auto">
        <BarraSesion
          usuarios={usuarios}
          sucursales={sucursales}
          usuario={usuario}
          sucursalId={sucursalId}
        />
      </div>
    </header>
  )
}
