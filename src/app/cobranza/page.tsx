import Link from 'next/link'
import { sql, faltaMigracion } from '@/lib/db'
import {
  MagnifyingGlassIcon, ArrowTopRightOnSquareIcon, ChatBubbleLeftRightIcon,
  ExclamationTriangleIcon, ClockIcon, BanknotesIcon, UserIcon, DocumentTextIcon,
} from '@heroicons/react/20/solid'
import { pesos, formatDia, tipoClienteLabel } from '@/lib/utils'
import type { Alerta, EstadoCuentaCliente, VentaCobranza } from '@/lib/types'
import RegistrarPago, { type VentaConSaldo } from './RegistrarPago'

export const dynamic = 'force-dynamic'

// Tolerancia de centavo: las vistas redondean a 2 decimales.
const CENTAVO = 0.01

const ORDEN_PRIORIDAD: Record<Alerta['prioridad'], number> = { alta: 0, media: 1, baja: 2 }

const COLOR_PRIORIDAD: Record<Alerta['prioridad'], string> = {
  alta: 'bg-red-50 border-red-200',
  media: 'bg-amber-50 border-amber-200',
  baja: 'bg-blue-50 border-blue-200',
}

const PUNTO_PRIORIDAD: Record<Alerta['prioridad'], string> = {
  alta: 'bg-red-500', media: 'bg-amber-500', baja: 'bg-blue-500',
}

const ETIQUETA_PRIORIDAD: Record<Alerta['prioridad'], string> = {
  alta: 'Alta', media: 'Media', baja: 'Baja',
}

// wa.me quiere puros dígitos con lada de país. Los teléfonos se capturan
// como los dicta el cliente: "33 1234 5678", "+52 33...", etc.
function numeroWa(tel: string | null | undefined): string | null {
  if (!tel) return null
  const d = tel.replace(/\D/g, '')
  if (d.length === 10) return `52${d}`          // número nacional sin lada de país
  if (d.length >= 11 && d.length <= 15) return d
  return null
}

// El cliente factura con su propio sistema, ej. Grajes con Contalink (minuta 36).
function etiquetaFacturaExterna(f: string | null | undefined): string | null {
  if (!f) return null
  const nombre = f === 'contalink' ? 'Contalink' : f === 'aspel' ? 'Aspel' : 'sistema externo'
  return `Factura con ${nombre}`
}

// El mensaje que se manda por WhatsApp. Es el seguimiento administrativo del
// punto 31: se persigue el pago con el folio y el saldo en la mano.
function mensajeCobranza(
  nombre: string,
  folio: string | null,
  saldo: number,
  diasVencida: number,
): string {
  const cual = folio ? `la factura ${folio}` : 'su cuenta'
  const atraso = diasVencida > 0 ? ` (vencida hace ${diasVencida} días)` : ''
  return (
    `Hola ${nombre}, le saluda ALFA-DEO. Le damos seguimiento al pago de ` +
    `${cual}${atraso}, con un saldo pendiente de ${pesos(saldo)}. ` +
    '¿Nos podría confirmar la fecha estimada de pago? Quedamos atentos, gracias.'
  )
}

export default async function CobranzaPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; adeudo?: string; vencidos?: string }>
}) {
  const params = await searchParams

  // Tres lecturas independientes, en paralelo:
  //  · el estado de cuenta por cliente (tabla y tarjetas),
  //  · las alertas de cobranza,
  //  · las ventas que todavía deben algo (para el botón de pago, el enlace de
  //    cada alerta y el folio que se cita por WhatsApp).
  const [ecRes, alertasRes, ventasRes] = await Promise.all([
    sql<EstadoCuentaCliente>(
      `select * from v_estado_cuenta_cliente order by saldo_vencido desc`
    ),
    sql<Alerta>(
      `select * from v_alertas where tipo = any($1)`,
      [['cobranza_vencida', 'cobranza_por_vencer']]
    ),
    sql<VentaCobranza>(
      `select * from v_ventas_cobranza
        where estado_cobranza = any($1)
        order by dias_vencida desc`,
      [['vencida', 'por_vencer', 'pendiente']]
    ),
  ])

  const error = ecRes.error ?? alertasRes.error ?? ventasRes.error
  const clientes = ecRes.data
  const alertas = alertasRes.data
  const ventasPendientes = ventasRes.data

  // Ventas con saldo agrupadas por cliente, ya ordenadas de más atrasada a
  // menos: la primera es la que se cita en el mensaje de cobranza.
  const ventasPorCliente = new Map<string, VentaConSaldo[]>()
  const clientePorVenta = new Map<string, string>()
  for (const v of ventasPendientes) {
    if (!v.cliente_id) continue
    clientePorVenta.set(v.venta_id, v.cliente_id)
    const lista = ventasPorCliente.get(v.cliente_id) ?? []
    lista.push({
      venta_id: v.venta_id,
      folio: v.folio,
      fecha: v.fecha,
      fecha_vencimiento: v.fecha_vencimiento,
      total: Number(v.total ?? 0),
      saldo: Number(v.saldo ?? 0),
      dias_vencida: Number(v.dias_vencida ?? 0),
    })
    ventasPorCliente.set(v.cliente_id, lista)
  }

  // --- Tarjetas -------------------------------------------------------
  const totalPorCobrar = clientes.reduce((s, c) => s + Number(c.saldo ?? 0), 0)
  const totalVencido = clientes.reduce((s, c) => s + Number(c.saldo_vencido ?? 0), 0)
  const conAdeudo = clientes.filter(c => Number(c.saldo ?? 0) > CENTAVO)
  const masAtrasado = clientes.reduce<EstadoCuentaCliente | null>((peor, c) => {
    const dias = Number(c.dias_mas_atrasado ?? 0)
    if (dias <= 0) return peor
    return !peor || dias > Number(peor.dias_mas_atrasado ?? 0) ? c : peor
  }, null)

  // --- Alertas --------------------------------------------------------
  // OJO: estas alertas salen de datos PROPIOS —ventas, pagos capturados a mano
  // y los días de crédito pactados con cada cliente—. No dependen de que el
  // SAT conteste ni de descargar el XML: la descarga del SAT sólo sirve para
  // confirmar después lo que aquí ya está registrado (minuta 32).
  const alertasOrdenadas = [...alertas].sort((a, b) => {
    const p = ORDEN_PRIORIDAD[a.prioridad] - ORDEN_PRIORIDAD[b.prioridad]
    if (p !== 0) return p
    // Dentro de la misma prioridad, primero lo más viejo: es lo que urge.
    return (a.fecha ?? '9999-12-31').localeCompare(b.fecha ?? '9999-12-31')
  })

  // --- Filtros de la tabla --------------------------------------------
  // "Sólo con adeudo" viene prendido: el tablero es para perseguir dinero, no
  // para listar a todos los clientes. Se apaga con adeudo=0.
  const soloAdeudo = params.adeudo !== '0'
  const soloVencidos = params.vencidos === '1'
  const q = (params.q ?? '').trim().toLowerCase()

  const filas = clientes
    .filter(c => {
      if (soloAdeudo && Number(c.saldo ?? 0) <= CENTAVO) return false
      if (soloVencidos && Number(c.saldo_vencido ?? 0) <= CENTAVO) return false
      if (q) {
        return [c.empresa, c.nombre, c.correo].some(campo => campo?.toLowerCase().includes(q))
      }
      return true
    })
    .sort((a, b) =>
      Number(b.saldo_vencido ?? 0) - Number(a.saldo_vencido ?? 0) ||
      Number(b.saldo ?? 0) - Number(a.saldo ?? 0)
    )

  const buildUrl = (o: Record<string, string | undefined>) => {
    const p: Record<string, string | undefined> = {
      q: params.q, adeudo: params.adeudo, vencidos: params.vencidos, ...o,
    }
    const qs = Object.entries(p)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
      .join('&')
    return `/cobranza${qs ? `?${qs}` : ''}`
  }

  const chip = (activo: boolean) =>
    `px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors ${
      activo ? 'text-white' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
    }`

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Cobranza</h1>
        <p className="text-base text-gray-500 mt-1">
          Quién debe, cuánto y desde cuándo. Los pagos se capturan aquí: el SAT y el
          banco sólo confirman después.
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

      {/* Tarjetas de arriba: el número que se pregunta en la junta */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-500 uppercase tracking-wide">
            <BanknotesIcon className="w-4 h-4" /> Total por cobrar
          </div>
          <div className="text-3xl font-semibold text-gray-900 mt-2">{pesos(totalPorCobrar)}</div>
          <div className="text-sm text-gray-500 mt-1">Saldo de todas las ventas cerradas</div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-500 uppercase tracking-wide">
            <ExclamationTriangleIcon className="w-4 h-4" /> Vencido
          </div>
          <div className={`text-3xl font-semibold mt-2 ${totalVencido > CENTAVO ? 'text-red-600' : 'text-gray-900'}`}>
            {pesos(totalVencido)}
          </div>
          <div className="text-sm text-gray-500 mt-1">
            {totalPorCobrar > CENTAVO
              ? `${Math.round((totalVencido / totalPorCobrar) * 100)}% de lo que está por cobrar`
              : 'Sin saldo vencido'}
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-500 uppercase tracking-wide">
            <UserIcon className="w-4 h-4" /> Clientes con adeudo
          </div>
          <div className="text-3xl font-semibold text-gray-900 mt-2">{conAdeudo.length}</div>
          <div className="text-sm text-gray-500 mt-1">
            {conAdeudo.filter(c => Number(c.saldo_vencido ?? 0) > CENTAVO).length} con saldo vencido
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-500 uppercase tracking-wide">
            <ClockIcon className="w-4 h-4" /> Más días de atraso
          </div>
          {masAtrasado ? (
            <>
              <div className="text-3xl font-semibold text-red-600 mt-2">
                {Number(masAtrasado.dias_mas_atrasado ?? 0)} días
              </div>
              <Link
                href={`/cobranza/${masAtrasado.cliente_id}`}
                className="text-sm text-[#003366] font-medium mt-1 inline-block hover:underline"
              >
                {masAtrasado.empresa ?? masAtrasado.nombre ?? 'Cliente sin nombre'}
              </Link>
            </>
          ) : (
            <>
              <div className="text-3xl font-semibold text-gray-900 mt-2">0 días</div>
              <div className="text-sm text-gray-500 mt-1">Nadie está vencido</div>
            </>
          )}
        </div>
      </div>

      {/* Alertas de cobranza (minuta 31 y 32) */}
      <div className="mb-8">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-900">
            Alertas de cobranza
            {alertasOrdenadas.length > 0 && (
              <span className="ml-2 text-base font-normal text-gray-500">
                {alertasOrdenadas.length}
              </span>
            )}
          </h2>
          <span className="text-sm text-gray-400">
            Calculadas con ventas y pagos propios, sin depender del SAT
          </span>
        </div>

        {alertasOrdenadas.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-400 text-base">
            No hay facturas vencidas ni por vencer. Todo al corriente.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {alertasOrdenadas.map((a, i) => {
              const clienteId = a.referencia_id ? clientePorVenta.get(a.referencia_id) : undefined
              // El enlace lleva al estado de cuenta del cliente con la venta
              // ya seleccionada; si la venta no está en la lista (por ejemplo
              // porque acaba de pagarse), lleva al tablero.
              const href = clienteId
                ? `/cobranza/${clienteId}${a.referencia_tipo === 'venta' && a.referencia_id ? `?venta=${a.referencia_id}` : ''}`
                : '/cobranza'
              return (
                <Link
                  key={`${a.tipo}-${a.referencia_id ?? i}`}
                  href={href}
                  className={`flex items-start gap-3 border rounded-xl p-4 transition-colors hover:brightness-[0.98] ${COLOR_PRIORIDAD[a.prioridad]}`}
                >
                  <span className={`w-2.5 h-2.5 rounded-full mt-2 shrink-0 ${PUNTO_PRIORIDAD[a.prioridad]}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-base font-semibold text-gray-900">{a.titulo}</span>
                      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        {a.tipo === 'cobranza_vencida' ? 'Vencida' : 'Por vencer'} · prioridad {ETIQUETA_PRIORIDAD[a.prioridad]}
                      </span>
                    </div>
                    <div className="text-base text-gray-600 mt-0.5">{a.detalle}</div>
                    <div className="text-sm text-gray-400 mt-1">
                      {a.sucursal ? `${a.sucursal} · ` : ''}{formatDia(a.fecha)}
                    </div>
                  </div>
                  {a.monto !== null && (
                    <div className="text-base font-semibold text-gray-900 whitespace-nowrap">
                      {pesos(Number(a.monto))}
                    </div>
                  )}
                </Link>
              )
            })}
          </div>
        )}
      </div>

      {/* Buscador + filtros */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6 space-y-4">
        <form method="GET">
          {/* Los filtros activos se conservan al buscar. */}
          {params.adeudo && <input type="hidden" name="adeudo" value={params.adeudo} />}
          {params.vencidos && <input type="hidden" name="vencidos" value={params.vencidos} />}
          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              name="q"
              defaultValue={params.q}
              placeholder="Buscar por empresa, contacto o correo..."
              className="w-full pl-11 pr-4 py-3 text-base border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366]"
            />
          </div>
        </form>

        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-sm text-gray-500 mr-1 font-medium">Mostrar:</span>
          <a
            href={buildUrl({ adeudo: soloAdeudo ? '0' : undefined })}
            className={chip(soloAdeudo)}
            style={soloAdeudo ? { background: '#003366', borderColor: '#003366' } : undefined}
          >
            Sólo con adeudo
          </a>
          <a
            href={buildUrl({ vencidos: soloVencidos ? undefined : '1' })}
            className={`px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              soloVencidos
                ? 'bg-red-500 text-white border-red-500'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
            }`}
          >
            Sólo vencidos
          </a>
        </div>
      </div>

      {/* Tabla por cliente (minuta 30) */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-base min-w-[1300px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Cliente</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Tipo</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Crédito</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Facturado</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Pagado</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Saldo</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Vencido</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Facturas venc.</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Atraso</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Último pago</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filas.length === 0 && (
                <tr>
                  <td colSpan={11} className="text-center py-20 text-gray-400 text-base">
                    Sin resultados.
                  </td>
                </tr>
              )}
              {filas.map(c => {
                const saldo = Number(c.saldo ?? 0)
                const vencido = Number(c.saldo_vencido ?? 0)
                const dias = Number(c.dias_mas_atrasado ?? 0)
                const ventasCliente = ventasPorCliente.get(c.cliente_id) ?? []
                const masVieja = ventasCliente[0]
                const wa = numeroWa(c.telefono_wa)
                const nombreCliente = c.empresa ?? c.nombre ?? 'Cliente sin nombre'
                const externa = etiquetaFacturaExterna(c.factura_externa)
                return (
                  <tr key={c.cliente_id} className="hover:bg-gray-50/60 transition-colors">
                    <td className="px-5 py-4">
                      <Link
                        href={`/cobranza/${c.cliente_id}`}
                        className="font-semibold text-gray-900 hover:text-[#003366] hover:underline"
                      >
                        {nombreCliente}
                      </Link>
                      {c.empresa && c.nombre && c.nombre !== c.empresa && (
                        <div className="text-sm text-gray-500 mt-0.5">{c.nombre}</div>
                      )}
                      {externa && (
                        // Minuta 36: hay clientes que facturan por su cuenta.
                        <div className="mt-1.5">
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-purple-700 bg-purple-50 px-2 py-1 rounded-md">
                            <DocumentTextIcon className="w-3.5 h-3.5" />
                            {externa}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-gray-600 whitespace-nowrap">{tipoClienteLabel(c.tipo)}</td>
                    <td className="px-5 py-4 text-gray-600 whitespace-nowrap">
                      {Number(c.dias_credito ?? 0) > 0 ? `${c.dias_credito} días` : 'Contado'}
                      {c.limite_credito != null && (
                        <div className="text-sm text-gray-400">Límite {pesos(Number(c.limite_credito))}</div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-gray-700 whitespace-nowrap">{pesos(Number(c.facturado ?? 0))}</td>
                    <td className="px-5 py-4 text-gray-700 whitespace-nowrap">{pesos(Number(c.pagado ?? 0))}</td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      <span className={`font-semibold ${saldo > CENTAVO ? 'text-gray-900' : 'text-gray-400'}`}>
                        {pesos(saldo)}
                      </span>
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      <span className={`font-semibold ${vencido > CENTAVO ? 'text-red-600' : 'text-gray-400'}`}>
                        {pesos(vencido)}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-gray-700">{Number(c.facturas_vencidas ?? 0)}</td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      {dias > 0 ? (
                        <span className={`inline-flex items-center gap-1.5 text-sm font-semibold px-2.5 py-1 rounded-md ${
                          dias > 15 ? 'bg-red-100 text-red-800' : dias > 5 ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-700'
                        }`}>
                          <ClockIcon className="w-4 h-4" />
                          {dias} días
                        </span>
                      ) : (
                        <span className="text-sm text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-gray-600 whitespace-nowrap">{formatDia(c.ultimo_pago)}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3 flex-wrap">
                        <RegistrarPago
                          ventas={ventasCliente}
                          clienteNombre={nombreCliente}
                          variante="enlace"
                          etiqueta="Pago"
                        />
                        {c.portal_pagos_url && (
                          // Clientes tipo IMSS: hay que entrar al portal a ver
                          // si ya liberaron el pago (minuta 35).
                          <a
                            href={c.portal_pagos_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-sm font-medium text-[#003366] hover:underline"
                          >
                            <ArrowTopRightOnSquareIcon className="w-4 h-4" />
                            Abrir portal
                          </a>
                        )}
                        {wa && (
                          // Seguimiento administrativo por WhatsApp (minuta 31).
                          <a
                            href={`https://wa.me/${wa}?text=${encodeURIComponent(
                              mensajeCobranza(
                                c.nombre ?? nombreCliente,
                                masVieja?.folio ?? null,
                                saldo,
                                masVieja?.dias_vencida ?? 0,
                              )
                            )}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 hover:underline"
                          >
                            <ChatBubbleLeftRightIcon className="w-4 h-4" />
                            WhatsApp
                          </a>
                        )}
                        <Link
                          href={`/cobranza/${c.cliente_id}`}
                          className="text-sm font-medium text-gray-500 hover:text-gray-700 hover:underline"
                        >
                          Estado de cuenta
                        </Link>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
