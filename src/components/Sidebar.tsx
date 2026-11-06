'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { GRUPOS_MENU, esRutaActiva } from './menu'

/**
 * Las secciones agrupadas. La usan la barra lateral de escritorio y el menú
 * ☰ del celular; `alElegir` es para que el menú del celular se cierre.
 */
export function ListaMenu({ alElegir }: { alElegir?: () => void }) {
  const path = usePathname()

  return (
    <nav className="flex-1 px-3 py-4 space-y-4">
      {GRUPOS_MENU.map((grupo, i) => (
        <div key={i} className="space-y-0.5">
          {grupo.titulo && (
            <div className="px-3 pb-1.5 text-[11px] font-semibold text-white/35 uppercase tracking-wider">
              {grupo.titulo}
            </div>
          )}
          {grupo.items.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={alElegir}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                esRutaActiva(path, href)
                  ? 'bg-white/15 text-white'
                  : 'text-white/60 hover:bg-white/8 hover:text-white/90'
              }`}
            >
              <Icon className="w-[18px] h-[18px] shrink-0" />
              {label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  )
}

// La barra lateral fija sólo aparece desde lg (1024px). Debajo, en celular y
// en tablet vertical, 224px de menú se comen un tercio de la pantalla; ahí el
// menú se abre con el botón ☰ del encabezado (MenuMovil).
export default function Sidebar() {
  return (
    <aside className="hidden lg:flex w-56 bg-[#003366] flex-col shrink-0 sticky top-14 h-[calc(100dvh-3.5rem)] overflow-y-auto">
      <ListaMenu />
      <div className="px-5 py-4 border-t border-white/10">
        <div className="text-white/25 text-xs">alfadeo.mx</div>
      </div>
    </aside>
  )
}
