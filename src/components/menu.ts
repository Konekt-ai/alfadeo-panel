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
//
// Lo comparten la barra lateral de escritorio y el menú ☰ del celular: es
// el mismo menú, sólo cambia dónde se pinta.
export const GRUPOS_MENU = [
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

export const esRutaActiva = (path: string, href: string) =>
  path === href || path.startsWith(href + '/')
