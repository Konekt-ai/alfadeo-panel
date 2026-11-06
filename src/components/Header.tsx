// Header del panel: logo + quién opera y en qué plaza.
//
// Recibe los datos ya cargados en vez de leerlos aquí. Es a propósito:
// un componente async dentro de JSX obliga a pelear con los tipos de
// React 18, y el layout ya es async de todos modos.

import Image from 'next/image'
import BarraSesion from './BarraSesion'
import MenuMovil from './MenuMovil'
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
    // Pegado arriba: en el celular el ☰ y el usuario tienen que estar a la
    // mano aunque la página vaya a la mitad.
    <header className="sticky top-0 z-40 h-14 bg-white border-b border-gray-200 flex items-center px-4 md:px-6 shrink-0 gap-2 sm:gap-3">
      <MenuMovil />
      <Image src="/logo.png" alt="ALFA-DEO" width={120} height={40} className="object-contain w-24 sm:w-[120px] h-auto" priority />
      <div className="ml-1 pl-3 border-l border-gray-200 text-xs text-gray-400 font-medium uppercase tracking-wider hidden md:block">
        Panel interno
      </div>
      <div className="ml-auto min-w-0">
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
