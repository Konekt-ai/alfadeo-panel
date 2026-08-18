import Link from 'next/link'
import { sql, faltaMigracion } from '@/lib/db'
import { pesos } from '@/lib/utils'
import { textoEntrega } from '@/lib/entrega'
import { usuarioActual } from '@/lib/usuario'
import type { Alerta } from '@/lib/types'
import {
  CalculatorIcon, ArrowsRightLeftIcon, TruckIcon, InboxArrowDownIcon,
  BanknotesIcon, ArchiveBoxIcon, QrCodeIcon,
} from '@heroicons/react/24/outline'
import {
  ExclamationTriangleIcon, ClockIcon, BeakerIcon, ArrowTrendingDownIcon,
} from '@heroicons/react/20/solid'

export const dynamic = 'force-dynamic'

// Iconos y colores por tipo de alerta. Las cuatro salen de `v_alertas`,
// que se arma con datos propios: no depende de que el SAT conteste
// (minuta 32).
const ESTILO_ALERTA = {
  cobranza_vencida:    { icon: ExclamationTriangleIcon, label: 'Cobranza vencida' },
  cobranza_por_vencer: { icon: ClockIcon,               label: 'Por vencer' },
  caducidad:           { icon: BeakerIcon,              label: 'Caducidad' },
  stock_bajo:          { icon: ArrowTrendingDownIcon,   label: 'Stock bajo' },
} as const

const COLOR_PRIORIDAD = {
  alta:  'bg-red-50 border-red-200 text-red-700',
  media: 'bg-amber-50 border-amber-200 text-amber-800',
  baja:  'bg-blue-50 border-blue-200 text-blue-700',
} as const

const ACCESOS = [
  { href: '/pos',          label: 'Punto de venta', desc: 'Cobrar y descontar inventario', icon: CalculatorIcon },
  { href: '/movimientos',  label: 'Movimientos',    desc: 'Entradas, salidas y ajustes',   icon: ArrowsRightLeftIcon },
  { href: '/compras',      label: 'Compras',        desc: 'Recibir mercancía',             icon: InboxArrowDownIcon },
  { href: '/traslados',    label: 'Traslados',      desc: 'Mandar producto a otra plaza',  icon: TruckIcon },
  { href: '/cobranza',     label: 'Cobranza',       desc: 'Adeudos y pagos',               icon: BanknotesIcon },
  { href: '/inventario',   label: 'Inventario',     desc: 'Catálogo y existencias',        icon: ArchiveBoxIcon },
  { href: '/verificador',  label: 'Verificador',    desc: 'Escanear y registrar códigos',  icon: QrCodeIcon },
]

export default async function InicioPage() {
  const hoy = new Date()
  const inicioDia = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).toISOString()

  const [alertasRes, cobranzaRes, ventasHoyRes] = await Promise.all([
    sql<Alerta>(`select * from v_alertas`),
    sql<{ saldo: number; estado_cobranza: string; total: number; estado: string }>(
      `select saldo, estado_cobranza, total, estado from v_ventas_cobranza`
    ),
    sql<{ total: number }>(
      `select total from ventas where estado = 'cerrada' and fecha >= $1`,
      [inicioDia]
    ),
  ])

  const error = alertasRes.error ?? cobranzaRes.error ?? ventasHoyRes.error

  const alertas = alertasRes.data
  const cobranza = cobranzaRes.data
  const ventasHoy = ventasHoyRes.data

  const porCobrar = cobranza
    .filter(v => v.estado === 'cerrada' && Number(v.saldo) > 0)
    .reduce((s, v) => s + Number(v.saldo), 0)
  const vencido = cobranza
    .filter(v => v.estado_cobranza === 'vencida')
    .reduce((s, v) => s + Number(v.saldo), 0)
  const vendidoHoy = ventasHoy.reduce((s, v) => s + Number(v.total), 0)

  const porPrioridad = { alta: 0, media: 1, baja: 2 } as const
  const alertasOrdenadas = [...alertas].sort(
    (a, b) => porPrioridad[a.prioridad] - porPrioridad[b.prioridad]
  )
  const caducando = alertas.filter(a => a.tipo === 'caducidad').length

  const tarjeta = 'bg-white border border-gray-200 rounded-xl p-5'

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">
          {usuarioActual() ? `Hola, ${usuarioActual()}` : 'Panel ALFA-DEO'}
        </h1>
        {/* Los tiempos de entrega se dicen desde el principio (minuta 6). */}
        <p className="text-base text-gray-500 mt-1">
          {hoy.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}
          {' · '}
          <span className="text-gray-600">Si sale hoy: {textoEntrega(hoy).replace('Llega el ', 'llega el ')}</span>
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-6 text-base">
          {error.message}
          {faltaMigracion(error.message) && (
            <p className="mt-2 text-sm">
              Falta preparar la base. En esa computadora corre{' '}
              <code className="font-mono">instalacion\instalar-base.ps1</code>.
            </p>
          )}
        </div>
      )}

      {/* Números del día */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className={tarjeta}>
          <div className="text-sm font-medium text-gray-500">Vendido hoy</div>
          <div className="text-2xl font-semibold text-gray-900 mt-1">{pesos(vendidoHoy)}</div>
          <div className="text-sm text-gray-400 mt-0.5">{ventasHoy.length} ventas</div>
        </div>
        <div className={tarjeta}>
          <div className="text-sm font-medium text-gray-500">Por cobrar</div>
          <div className="text-2xl font-semibold text-gray-900 mt-1">{pesos(porCobrar)}</div>
          <div className="text-sm text-gray-400 mt-0.5">saldo total</div>
        </div>
        <div className={tarjeta}>
          <div className="text-sm font-medium text-gray-500">Vencido</div>
          <div className={`text-2xl font-semibold mt-1 ${vencido > 0 ? 'text-red-600' : 'text-gray-900'}`}>
            {pesos(vencido)}
          </div>
          <div className="text-sm text-gray-400 mt-0.5">
            {cobranza.filter(v => v.estado_cobranza === 'vencida').length} facturas
          </div>
        </div>
        <div className={tarjeta}>
          <div className="text-sm font-medium text-gray-500">Por caducar</div>
          <div className={`text-2xl font-semibold mt-1 ${caducando > 0 ? 'text-amber-600' : 'text-gray-900'}`}>
            {caducando}
          </div>
          <div className="text-sm text-gray-400 mt-0.5">lotes en 60 días</div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Pendientes del día (minuta 31) */}
        <div className="lg:col-span-2">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-lg font-semibold text-gray-900">Pendientes</h2>
            <span className="text-sm text-gray-400">{alertas.length} en total</span>
          </div>
          <div className="space-y-2">
            {alertasOrdenadas.length === 0 && (
              <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-400 text-base">
                Nada pendiente. Todo al corriente.
              </div>
            )}
            {alertasOrdenadas.slice(0, 12).map((a, i) => {
              const estilo = ESTILO_ALERTA[a.tipo] ?? ESTILO_ALERTA.stock_bajo
              const Icon = estilo.icon
              const destino = a.tipo.startsWith('cobranza')
                ? `/ventas/${a.referencia_id}`
                : `/inventario?q=${encodeURIComponent(a.titulo)}`
              return (
                <Link
                  key={`${a.tipo}-${a.referencia_id}-${i}`}
                  href={destino}
                  className={`flex items-start gap-3 border rounded-xl p-4 transition-colors hover:brightness-[0.98] ${COLOR_PRIORIDAD[a.prioridad]}`}
                >
                  <Icon className="w-5 h-5 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-base truncate">{a.titulo}</div>
                    <div className="text-sm opacity-80 mt-0.5">{a.detalle}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-medium uppercase tracking-wide opacity-60">
                      {estilo.label}
                    </div>
                    {a.sucursal && <div className="text-sm font-semibold mt-0.5">{a.sucursal}</div>}
                  </div>
                </Link>
              )
            })}
            {alertasOrdenadas.length > 12 && (
              <Link href="/cobranza" className="block text-center text-sm font-medium text-[#003366] py-3 hover:underline">
                Ver los {alertasOrdenadas.length - 12} restantes
              </Link>
            )}
          </div>
        </div>

        {/* Accesos: todo desde una sola plataforma (minuta 21) */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Ir a</h2>
          <div className="grid grid-cols-2 lg:grid-cols-1 gap-2">
            {ACCESOS.map(({ href, label, desc, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl p-4 hover:border-[#003366]/30 hover:shadow-sm transition-all"
              >
                <div className="w-10 h-10 rounded-lg bg-[#003366]/8 flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5 text-[#003366]" />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-base text-gray-900">{label}</div>
                  <div className="text-sm text-gray-500 truncate">{desc}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
