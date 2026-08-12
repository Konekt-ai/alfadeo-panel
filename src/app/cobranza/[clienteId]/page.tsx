import Link from 'next/link'
import { notFound } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import {
  ArrowLeftIcon, ArrowTopRightOnSquareIcon, ChatBubbleLeftRightIcon,
  CheckCircleIcon, ExclamationTriangleIcon, ClockIcon, DocumentTextIcon,
} from '@heroicons/react/20/solid'
import {
  pesos, formatDia, formatDate, tipoClienteLabel, formaPagoLabel,
  cobranzaLabel, cobranzaColor,
} from '@/lib/utils'
import { DIAS_CREDITO, METODOS_PAGO } from '@/lib/constantes'
import type { EstadoCuentaCliente, Pago, VentaCobranza } from '@/lib/types'
import RegistrarPago, { type VentaConSaldo } from '../RegistrarPago'
import { actualizarCredito } from '../acciones'

export const dynamic = 'force-dynamic'

const CENTAVO = 0.01

const metodoLabel = (m: string) =>
  METODOS_PAGO.find(x => x.valor === m)?.label ?? m

// wa.me quiere puros dígitos con lada de país (mismo criterio que el tablero).
function numeroWa(tel: string | null | undefined): string | null {
  if (!tel) return null
  const d = tel.replace(/\D/g, '')
  if (d.length === 10) return `52${d}`
  if (d.length >= 11 && d.length <= 15) return d
  return null
}

// Minuta 36: hay clientes que facturan con su propio sistema.
function etiquetaFacturaExterna(f: string | null | undefined): string | null {
  if (!f) return null
  const nombre = f === 'contalink' ? 'Contalink' : f === 'aspel' ? 'Aspel' : 'sistema externo'
  return `Factura con ${nombre}`
}

export default async function EstadoCuentaPage({
  params,
  searchParams,
}: {
  params: Promise<{ clienteId: string }>
  searchParams: Promise<{ venta?: string; ok?: string; err?: string }>
}) {
  const { clienteId } = await params
  const query = await searchParams

  const [ecRes, ventasRes, pagosRes] = await Promise.all([
    supabase.from('v_estado_cuenta_cliente').select('*').eq('cliente_id', clienteId).maybeSingle(),
    supabase.from('v_ventas_cobranza').select('*').eq('cliente_id', clienteId)
      .order('fecha', { ascending: false }),
    supabase.from('pagos').select('*').eq('cliente_id', clienteId)
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false }),
  ])

  const error = ecRes.error ?? ventasRes.error ?? pagosRes.error
  const ec = ecRes.data as EstadoCuentaCliente | null

  if (error) {
    return (
      <div className="p-8">
        <Link href="/cobranza" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 mb-6">
          <ArrowLeftIcon className="w-3.5 h-3.5" /> Cobranza
        </Link>
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-base">
          {error.message}
          {/relation|column|function|schema cache|does not exist|no existe/i.test(error.message) && (
            <p className="mt-2 text-sm">
              Falta correr <code className="font-mono">supabase/reunion-operacion.sql</code> en el SQL Editor de Supabase.
            </p>
          )}
        </div>
      </div>
    )
  }

  if (!ec) return notFound()

  const ventas = (ventasRes.data ?? []) as VentaCobranza[]
  const pagos = (pagosRes.data ?? []) as Pago[]

  // Las que todavía deben algo: son las que se le ofrecen al formulario de pago.
  const conSaldo: VentaConSaldo[] = ventas
    .filter(v => v.estado !== 'cancelada' && Number(v.saldo ?? 0) > CENTAVO)
    .sort((a, b) => Number(b.dias_vencida ?? 0) - Number(a.dias_vencida ?? 0))
    .map(v => ({
      venta_id: v.venta_id,
      folio: v.folio,
      fecha: v.fecha,
      fecha_vencimiento: v.fecha_vencimiento,
      total: Number(v.total ?? 0),
      saldo: Number(v.saldo ?? 0),
      dias_vencida: Number(v.dias_vencida ?? 0),
    }))

  const nombreCliente = ec.empresa ?? ec.nombre ?? 'Cliente sin nombre'
  const saldo = Number(ec.saldo ?? 0)
  const vencido = Number(ec.saldo_vencido ?? 0)
  const limite = ec.limite_credito == null ? null : Number(ec.limite_credito)
  const disponible = limite == null ? null : limite - saldo
  const wa = numeroWa(ec.telefono_wa)
  const externa = etiquetaFacturaExterna(ec.factura_externa)
  const masVieja = conSaldo[0]

  // Folio de cada venta, para poder decir a qué factura se aplicó cada pago.
  const folioPorVenta = new Map<string, string | null>(ventas.map(v => [v.venta_id, v.folio]))

  const mensajeWa =
    `Hola ${ec.nombre ?? nombreCliente}, le saluda ALFA-DEO. Le damos seguimiento al pago de ` +
    `${masVieja?.folio ? `la factura ${masVieja.folio}` : 'su cuenta'}` +
    `${masVieja && masVieja.dias_vencida > 0 ? ` (vencida hace ${masVieja.dias_vencida} días)` : ''}, ` +
    `con un saldo pendiente de ${pesos(saldo)}. ¿Nos podría confirmar la fecha estimada de pago? ` +
    'Quedamos atentos, gracias.'

  // Opciones del plazo pactado: las que ya manejan (minuta 34) más la que
  // tenga guardada el cliente, para no perderla al abrir el formulario.
  const opcionesDias = Array.from(
    new Set([0, ...DIAS_CREDITO, Number(ec.dias_credito ?? 0)])
  ).sort((a, b) => a - b)

  const inputCls =
    'w-full px-4 py-3 text-base border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366]'
  const labelCls = 'block text-sm font-medium text-gray-500 mb-1.5'
  const thCls = 'text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide'

  return (
    <div className="p-8">
      <Link href="/cobranza" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 mb-6">
        <ArrowLeftIcon className="w-3.5 h-3.5" /> Cobranza
      </Link>

      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{nombreCliente}</h1>
          <p className="text-base text-gray-500 mt-1">
            {tipoClienteLabel(ec.tipo)}
            {ec.empresa && ec.nombre && ec.nombre !== ec.empresa ? ` · ${ec.nombre}` : ''}
            {ec.correo ? ` · ${ec.correo}` : ''}
            {ec.telefono_wa ? ` · ${ec.telefono_wa}` : ''}
          </p>
          {externa && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-purple-700 bg-purple-50 px-2 py-1 rounded-md mt-2">
              <DocumentTextIcon className="w-3.5 h-3.5" />
              {externa}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {ec.portal_pagos_url && (
            // Clientes tipo IMSS: hay que entrar al portal a checar si ya
            // liberaron el pago (minuta 35).
            <a
              href={ec.portal_pagos_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 border border-gray-200 bg-white text-[#003366] text-base font-medium rounded-lg hover:border-gray-300 transition-colors"
            >
              <ArrowTopRightOnSquareIcon className="w-5 h-5" />
              Abrir portal
            </a>
          )}
          {wa && (
            // Seguimiento administrativo por WhatsApp (minuta 31).
            <a
              href={`https://wa.me/${wa}?text=${encodeURIComponent(mensajeWa)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 border border-emerald-200 bg-emerald-50 text-emerald-800 text-base font-medium rounded-lg hover:bg-emerald-100 transition-colors"
            >
              <ChatBubbleLeftRightIcon className="w-5 h-5" />
              WhatsApp
            </a>
          )}
          <RegistrarPago
            ventas={conSaldo}
            clienteNombre={nombreCliente}
            ventaId={query.venta}
          />
        </div>
      </div>

      {query.ok && (
        <div className="flex items-start gap-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-4 mb-6 text-base">
          <CheckCircleIcon className="w-5 h-5 mt-0.5 shrink-0" />
          <span>{query.ok}</span>
        </div>
      )}
      {query.err && (
        <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-6 text-base">
          <ExclamationTriangleIcon className="w-5 h-5 mt-0.5 shrink-0" />
          <span>{query.err}</span>
        </div>
      )}

      {/* Resumen de saldos */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Facturado</div>
          <div className="text-2xl font-semibold text-gray-900 mt-2">{pesos(Number(ec.facturado ?? 0))}</div>
          <div className="text-sm text-gray-500 mt-1">{Number(ec.ventas ?? 0)} ventas cerradas</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Pagado</div>
          <div className="text-2xl font-semibold text-gray-900 mt-2">{pesos(Number(ec.pagado ?? 0))}</div>
          <div className="text-sm text-gray-500 mt-1">Último pago: {formatDia(ec.ultimo_pago)}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Saldo</div>
          <div className={`text-2xl font-semibold mt-2 ${saldo > CENTAVO ? 'text-gray-900' : 'text-gray-400'}`}>
            {pesos(saldo)}
          </div>
          <div className="text-sm text-gray-500 mt-1">
            {limite == null
              ? 'Sin límite de crédito capturado'
              : `Límite ${pesos(limite)} · disponible ${pesos(disponible ?? 0)}`}
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Vencido</div>
          <div className={`text-2xl font-semibold mt-2 ${vencido > CENTAVO ? 'text-red-600' : 'text-gray-400'}`}>
            {pesos(vencido)}
          </div>
          <div className="text-sm text-gray-500 mt-1">
            {Number(ec.facturas_vencidas ?? 0)} facturas
            {Number(ec.dias_mas_atrasado ?? 0) > 0 ? ` · hasta ${ec.dias_mas_atrasado} días de atraso` : ''}
          </div>
        </div>
      </div>

      {/* Condiciones de crédito: son los datos que hacen funcionar el resto
          —vencimientos, alertas y el portal que hay que revisar— (minuta 34, 35, 36). */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-8">
        <h2 className="text-lg font-semibold text-gray-900">Condiciones de crédito</h2>
        <p className="text-base text-gray-500 mt-1 mb-5">
          De aquí sale la fecha de vencimiento de cada venta y, con ella, las alertas de cobranza.
        </p>

        <form action={actualizarCredito} className="space-y-5">
          <input type="hidden" name="cliente_id" value={ec.cliente_id} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelCls} htmlFor="dias_credito">Días de crédito</label>
              <select
                id="dias_credito"
                name="dias_credito"
                defaultValue={String(Number(ec.dias_credito ?? 0))}
                className={`${inputCls} bg-white`}
              >
                {opcionesDias.map(d => (
                  <option key={d} value={String(d)}>{d === 0 ? 'Contado (0 días)' : `${d} días`}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="limite_credito">Límite de crédito</label>
              <input
                id="limite_credito"
                name="limite_credito"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                defaultValue={limite == null ? '' : String(limite)}
                placeholder="Sin límite"
                className={inputCls}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelCls} htmlFor="portal_pagos_url">Portal de pagos</label>
              <input
                id="portal_pagos_url"
                name="portal_pagos_url"
                type="url"
                defaultValue={ec.portal_pagos_url ?? ''}
                placeholder="https://..."
                className={inputCls}
              />
              <p className="text-sm text-gray-400 mt-1.5">
                Para clientes tipo IMSS: la página donde se consulta si ya liberaron el pago.
              </p>
            </div>
            <div>
              <label className={labelCls} htmlFor="factura_externa">Factura con sistema externo</label>
              <select
                id="factura_externa"
                name="factura_externa"
                defaultValue={ec.factura_externa ?? ''}
                className={`${inputCls} bg-white`}
              >
                <option value="">No (facturamos nosotros)</option>
                <option value="contalink">Contalink</option>
                <option value="aspel">Aspel</option>
                <option value="otro">Otro</option>
              </select>
              <p className="text-sm text-gray-400 mt-1.5">
                El cliente emite su factura por su cuenta; aquí sólo se lleva el cobro.
              </p>
            </div>
          </div>

          <button
            type="submit"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#003366] text-white text-base font-medium rounded-lg hover:bg-[#002244] transition-colors"
          >
            Guardar condiciones
          </button>
        </form>
      </div>

      {/* Ventas del cliente */}
      <h2 className="text-lg font-semibold text-gray-900 mb-3">
        Ventas <span className="text-base font-normal text-gray-500">{ventas.length}</span>
      </h2>
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-8">
        <div className="overflow-x-auto">
          <table className="w-full text-base min-w-[1200px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className={thCls}>Folio</th>
                <th className={thCls}>Fecha</th>
                <th className={thCls}>Estado</th>
                <th className={thCls}>Forma de pago</th>
                <th className={thCls}>Vencimiento</th>
                <th className={thCls}>Atraso</th>
                <th className={thCls}>Total</th>
                <th className={thCls}>Pagado</th>
                <th className={thCls}>Saldo</th>
                <th className="px-5 py-4" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {ventas.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center py-20 text-gray-400 text-base">
                    Este cliente todavía no tiene ventas registradas.
                  </td>
                </tr>
              )}
              {ventas.map(v => {
                const saldoVenta = Number(v.saldo ?? 0)
                const dias = Number(v.dias_vencida ?? 0)
                const pagable = v.estado !== 'cancelada' && saldoVenta > CENTAVO
                // La venta que venía marcada desde una alerta se resalta.
                const resaltada = query.venta === v.venta_id
                return (
                  <tr
                    key={v.venta_id}
                    className={`transition-colors ${resaltada ? 'bg-amber-50' : 'hover:bg-gray-50/60'}`}
                  >
                    <td className="px-5 py-4 font-semibold text-gray-900 whitespace-nowrap">
                      {v.folio ?? 'Sin folio'}
                      {v.factura_uuid && (
                        <div className="text-xs text-gray-400 font-mono mt-0.5">
                          {v.factura_uuid.slice(0, 8)}…
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-gray-600 whitespace-nowrap">{formatDia(v.fecha)}</td>
                    <td className="px-5 py-4">
                      <span className={`text-sm font-semibold px-2.5 py-1 rounded-md whitespace-nowrap ${cobranzaColor(v.estado_cobranza)}`}>
                        {cobranzaLabel(v.estado_cobranza)}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-gray-600 whitespace-nowrap">
                      {formaPagoLabel(v.forma_pago)}
                      {Number(v.dias_credito ?? 0) > 0 && (
                        <span className="text-sm text-gray-400"> · {v.dias_credito} días</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-gray-600 whitespace-nowrap">{formatDia(v.fecha_vencimiento)}</td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      {v.estado_cobranza === 'vencida' && dias > 0 ? (
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
                    <td className="px-5 py-4 text-gray-700 whitespace-nowrap">{pesos(Number(v.total ?? 0))}</td>
                    <td className="px-5 py-4 text-gray-700 whitespace-nowrap">{pesos(Number(v.pagado ?? 0))}</td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      <span className={`font-semibold ${
                        v.estado_cobranza === 'vencida' && saldoVenta > CENTAVO
                          ? 'text-red-600'
                          : saldoVenta > CENTAVO ? 'text-gray-900' : 'text-gray-400'
                      }`}>
                        {pesos(saldoVenta)}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      {pagable && (
                        <RegistrarPago
                          ventas={conSaldo}
                          clienteNombre={nombreCliente}
                          ventaId={v.venta_id}
                          variante="enlace"
                          etiqueta="Registrar pago"
                        />
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Historial de pagos */}
      <h2 className="text-lg font-semibold text-gray-900 mb-3">
        Pagos recibidos <span className="text-base font-normal text-gray-500">{pagos.length}</span>
      </h2>
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-base min-w-[900px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className={thCls}>Fecha</th>
                <th className={thCls}>Venta</th>
                <th className={thCls}>Monto</th>
                <th className={thCls}>Método</th>
                <th className={thCls}>Referencia</th>
                <th className={thCls}>Capturó</th>
                <th className={thCls}>Notas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {pagos.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-20 text-gray-400 text-base">
                    Todavía no se registra ningún pago de este cliente.
                  </td>
                </tr>
              )}
              {pagos.map(p => (
                <tr key={p.id} className="hover:bg-gray-50/60 transition-colors">
                  <td className="px-5 py-4 text-gray-700 whitespace-nowrap">
                    {formatDia(p.fecha)}
                    <div className="text-xs text-gray-400 mt-0.5">Capturado {formatDate(p.created_at)}</div>
                  </td>
                  <td className="px-5 py-4 text-gray-600 whitespace-nowrap">
                    {p.venta_id ? (folioPorVenta.get(p.venta_id) ?? 'Sin folio') : 'Sin venta'}
                  </td>
                  <td className="px-5 py-4 font-semibold text-emerald-700 whitespace-nowrap">
                    {pesos(Number(p.monto ?? 0))}
                  </td>
                  <td className="px-5 py-4 text-gray-600 whitespace-nowrap">
                    {metodoLabel(p.metodo)}
                    {p.origen !== 'manual' && (
                      <span className="text-xs text-gray-400"> · {p.origen}</span>
                    )}
                  </td>
                  <td className="px-5 py-4 font-mono text-sm text-gray-500">{p.referencia ?? '—'}</td>
                  <td className="px-5 py-4 text-gray-500">{p.usuario ?? '—'}</td>
                  <td className="px-5 py-4 text-gray-500">{p.notas ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
