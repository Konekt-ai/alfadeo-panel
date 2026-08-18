'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  ClipboardDocumentListIcon,
  UsersIcon,
  ArchiveBoxIcon,
  TruckIcon,
  CalculatorIcon,
  ArrowsRightLeftIcon,
  BanknotesIcon,
  QrCodeIcon,
  ReceiptPercentIcon,
  InboxArrowDownIcon,
  HomeIcon,
} from '@heroicons/react/24/outline'

// El menú va agrupado por lo que hace la persona, no por tabla de la base.
// Arriba lo que se usa a diario en el mostrador (minuta 11, 16), abajo lo
// administrativo (minuta 33). Todo en una sola plataforma (minuta 21).
const grupos = [
  {
    titulo: null,
    items: [
      { href: '/inicio', label: 'Inicio', icon: HomeIcon },
      { href: '/pos', label: 'Punto de venta', icon: CalculatorIcon },
    ],
  },
  {
    titulo: 'Almacén',
    items: [
      { href: '/inventario', label: 'Inventario', icon: ArchiveBoxIcon },
      { href: '/verificador', label: 'Verificador', icon: QrCodeIcon },
      { href: '/movimientos', label: 'Movimientos', icon: ArrowsRightLeftIcon },
      { href: '/traslados', label: 'Traslados', icon: TruckIcon },
      { href: '/compras', label: 'Compras', icon: InboxArrowDownIcon },
    ],
  },
  {
    titulo: 'Comercial',
    items: [
      { href: '/solicitudes', label: 'Solicitudes', icon: ClipboardDocumentListIcon },
      { href: '/ventas', label: 'Ventas', icon: ReceiptPercentIcon },
      { href: '/clientes', label: 'Clientes', icon: UsersIcon },
    ],
  },
  {
    titulo: 'Administración',
    items: [
      { href: '/cobranza', label: 'Cobranza', icon: BanknotesIcon },
      { href: '/proveedores', label: 'Proveedores', icon: TruckIcon },
    ],
  },
]

// En el celular no caben diez: van las cinco de uso diario. El resto se
// alcanza desde Inicio.
const navMovil = [
  { href: '/pos', label: 'Vender', icon: CalculatorIcon },
  { href: '/inventario', label: 'Inventario', icon: ArchiveBoxIcon },
  { href: '/verificador', label: 'Códigos', icon: QrCodeIcon },
  { href: '/ventas', label: 'Ventas', icon: ReceiptPercentIcon },
  { href: '/cobranza', label: 'Cobranza', icon: BanknotesIcon },
]

export default function Sidebar() {
  const path = usePathname()
  const esActivo = (href: string) => path === href || path.startsWith(href + '/')

  return (
    <>
      {/* Sidebar — escritorio */}
      <aside className="hidden md:flex w-56 bg-[#003366] flex-col shrink-0 overflow-y-auto">
        <nav className="flex-1 px-3 py-4 space-y-4">
          {grupos.map((grupo, i) => (
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
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    esActivo(href)
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
        <div className="px-5 py-4 border-t border-white/10">
          <div className="text-white/25 text-xs">alfadeo.mx</div>
        </div>
      </aside>

      {/* Barra inferior — celular */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#003366] flex border-t border-white/10 pb-safe">
        {navMovil.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`flex-1 flex flex-col items-center gap-1 py-3 text-[10px] font-medium transition-colors ${
              esActivo(href) ? 'text-white' : 'text-white/45'
            }`}
          >
            <Icon className="w-5 h-5" />
            {label}
          </Link>
        ))}
      </nav>
    </>
  )
}
