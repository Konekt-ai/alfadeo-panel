'use client'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import {
  ClipboardDocumentListIcon,
  UsersIcon,
  ArchiveBoxIcon,
  TruckIcon,
} from '@heroicons/react/24/outline'

const nav = [
  { href: '/solicitudes', label: 'Solicitudes', icon: ClipboardDocumentListIcon },
  { href: '/clientes', label: 'Clientes', icon: UsersIcon },
  { href: '/inventario', label: 'Inventario', icon: ArchiveBoxIcon },
  { href: '/proveedores', label: 'Proveedores', icon: TruckIcon },
]

export function Header() {
  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center px-4 md:px-6 shrink-0">
      <Image src="/logo.png" alt="ALFA-DEO" width={120} height={40} className="object-contain" priority />
      <div className="ml-3 pl-3 border-l border-gray-200 text-xs text-gray-400 font-medium uppercase tracking-wider hidden sm:block">
        Panel interno
      </div>
    </header>
  )
}

export default function Sidebar() {
  const path = usePathname()

  return (
    <>
      {/* Sidebar — desktop */}
      <aside className="hidden md:flex w-52 bg-[#003366] flex-col shrink-0">
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = path.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-white/15 text-white'
                    : 'text-white/55 hover:bg-white/8 hover:text-white/85'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {label}
              </Link>
            )
          })}
        </nav>
        <div className="px-5 py-4 border-t border-white/10">
          <div className="text-white/25 text-xs">alfadeo.mx</div>
        </div>
      </aside>

      {/* Bottom nav — mobile */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#003366] flex border-t border-white/10 pb-safe">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = path.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={`flex-1 flex flex-col items-center gap-1 py-3 text-[10px] font-medium transition-colors ${
                active ? 'text-white' : 'text-white/45'
              }`}
            >
              <Icon className="w-5 h-5" />
              {label}
            </Link>
          )
        })}
      </nav>
    </>
  )
}
