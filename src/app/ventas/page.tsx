import { sql, faltaMigracion } from '@/lib/db'
import Link from 'next/link'
import { MagnifyingGlassIcon } from '@heroicons/react/20/solid'
import { SUCURSALES, FORMAS_PAGO } from '@/lib/constantes'
import { pesos, formatDia, cobranzaLabel, cobranzaColor, formaPagoLabel } from '@/lib/utils'
import type { EstadoCobranza, VentaCobranza } from '@/lib/types'

export const dynamic = 'force-dynamic'

// Estado de cobranza en el orden en que lo persigue el equipo: primero lo que
// duele (minuta 33).
const ESTADOS: EstadoCobranza[] = ['vencida', 'por_vencer', 'pendiente', 'pagada', 'cancelada']

// De dónde entró la venta. `canalLabel` de utils sólo cubre el bot, aquí hay
// además mostrador y panel.
const CANALES: Record<string, string> = {
  pos: 'Mostrador',
  panel: 'Panel',
  whatsapp: 'WhatsApp',
  web: 'Web',
}

const TOPE = 500

// Lo que comparten la tabla (escritorio) y las tarjetas (teléfono), para que
// las dos vistas digan exactamente lo mismo.
const clienteTitulo = (v: VentaCobranza) => v.cliente_empresa || v.cliente_nombre || 'Público en general'
const plazaColor = (plaza: string) =>
  plaza === 'GDL' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'
const formaDetalle = (v: VentaCobranza) =>
  formaPagoLabel(v.forma_pago) +
  (v.forma_pago === 'credito' && v.fecha_vencimiento ? ` · vence ${formatDia(v.fecha_vencimiento)}` : '')
const atraso = (v: VentaCobranza) =>
  Number(v.dias_vencida ?? 0) > 0 && v.estado_cobranza === 'vencida' ? `${v.dias_vencida} días de atraso` : null

export default async function VentasPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string
    estado?: string
    sucursal?: string
    forma?: string
    factura?: string
    desde?: string
    hasta?: string
  }>
}) {
  const params = await searchParams

  const { data: todas, error } = await sql<VentaCobranza>(
    `select *
       from v_ventas_cobranza
      order by fecha desc, folio desc
      limit $1`,
    [TOPE]
  )

  const rows = todas.filter((v: VentaCobranza) => {
    if (params.estado && v.estado_cobranza !== params.estado) return false
    // La vista trae la clave de la plaza; se acepta también el nombre por si
    // en algún ambiente viene completo.
    if (params.sucursal && v.sucursal !== params.sucursal) {
      const plaza = SUCURSALES.find(s => s.clave === params.sucursal)
      if (!plaza || v.sucursal !== plaza.nombre) return false
    }
    if (params.forma && v.forma_pago !== params.forma) return false
    if (params.factura === 'si' && !v.factura_uuid) return false
    if (params.factura === 'no' && v.factura_uuid) return false

    const dia = String(v.fecha ?? '').slice(0, 10)
    if (params.desde && dia < params.desde) return false
    if (params.hasta && dia > params.hasta) return false

    if (params.q) {
      // Se busca como lo pide el cliente por teléfono: por folio o por nombre.
      const q = params.q.trim().toLowerCase()
      return [v.folio, v.cliente_nombre, v.cliente_empresa]
        .some(campo => campo?.toLowerCase().includes(q))
    }
    return true
  })

  // Resumen del periodo filtrado. Las canceladas no suman dinero.
  const vivas = rows.filter(v => v.estado_cobranza !== 'cancelada')
  const totalVendido = vivas.reduce((s, v) => s + Number(v.total ?? 0), 0)
  const porCobrar = vivas.reduce((s, v) => s + Number(v.saldo ?? 0), 0)
  const vencidas = vivas.filter(v => v.estado_cobranza === 'vencida')
  const totalVencido = vencidas.reduce((s, v) => s + Number(v.saldo ?? 0), 0)
  const canceladas = rows.length - vivas.length

  const buildUrl = (o: Record<string, string | undefined>) => {
    const p: Record<string, string | undefined> = {
      q: params.q, estado: params.estado, sucursal: params.sucursal,
      forma: params.forma, factura: params.factura,
      desde: params.desde, hasta: params.hasta, ...o,
    }
    const qs = Object.entries(p)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
      .join('&')
    return `/ventas${qs ? `?${qs}` : ''}`
  }

  const chipBase = 'px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors'
  const chipInactivo = 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
  const chipAzul = 'bg-[#003366] text-white border-[#003366]'
  const inputCls = 'px-4 py-3 text-base border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366]'
  const ROTULO = 'text-sm text-gray-500 font-medium w-full sm:w-32 shrink-0'
  const FILA_CHIPS = 'flex gap-2 flex-wrap sm:items-center'
  const CHIPS = 'flex gap-2 overflow-x-auto sm:flex-wrap sm:overflow-visible -mx-1 px-1 pb-1 sm:pb-0 [&>*]:shrink-0'

  const tarjetas: { titulo: string; valor: string; detalle: string; color: string }[] = [
    { titulo: 'Vendido', valor: pesos(totalVendido), detalle: 'Total del periodo filtrado', color: 'text-gray-900' },
    { titulo: 'Por cobrar', valor: pesos(porCobrar), detalle: 'Saldo pendiente de estas ventas', color: 'text-[#003366]' },
    { titulo: 'Vencido', valor: pesos(totalVencido), detalle: `${vencidas.length} ${vencidas.length === 1 ? 'venta vencida' : 'ventas vencidas'}`, color: totalVencido > 0 ? 'text-red-600' : 'text-gray-900' },
    { titulo: 'Ventas', valor: vivas.length.toLocaleString('es-MX'), detalle: canceladas > 0 ? `${canceladas} canceladas aparte` : 'En el periodo filtrado', color: 'text-gray-900' },
  ]

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6 sm:mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Ventas</h1>
          <p className="text-base text-gray-500 mt-1">
            Estado de cada venta, pagos, adeudos y seguimiento · {rows.length}{' '}
            {rows.length === 1 ? 'venta' : 'ventas'}
          </p>
        </div>
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

      {/* Resumen del periodo */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        {tarjetas.map(t => (
          <div key={t.titulo} className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5 min-w-0">
            <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide">{t.titulo}</p>
            <p className={`text-xl sm:text-2xl font-semibold mt-2 break-words ${t.color}`}>{t.valor}</p>
            <p className="text-sm text-gray-400 mt-1">{t.detalle}</p>
          </div>
        ))}
      </div>

      {/* Buscador + filtros */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5 mb-6 space-y-4">
        <form method="GET" className="flex flex-col md:flex-row gap-3 md:items-center">
          {/* Los filtros activos se conservan al buscar. */}
          {params.estado && <input type="hidden" name="estado" value={params.estado} />}
          {params.sucursal && <input type="hidden" name="sucursal" value={params.sucursal} />}
          {params.forma && <input type="hidden" name="forma" value={params.forma} />}
          {params.factura && <input type="hidden" name="factura" value={params.factura} />}
          <div className="relative flex-1">
            <MagnifyingGlassIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              name="q"
              defaultValue={params.q}
              placeholder="Buscar por folio o por cliente..."
              className="w-full pl-11 pr-4 py-3 text-base border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366]"
            />
          </div>
          {/* En el teléfono las dos fechas van lado a lado con su rótulo
              arriba; en una sola línea no caben a 360px. */}
          <div className="grid grid-cols-2 gap-3 md:flex md:items-center md:gap-2">
            <label className="flex flex-col gap-1 md:flex-row md:items-center md:gap-2 min-w-0 text-sm text-gray-500 font-medium">
              Del
              <input type="date" name="desde" defaultValue={params.desde} className={`${inputCls} w-full min-w-0 md:w-auto`} />
            </label>
            <label className="flex flex-col gap-1 md:flex-row md:items-center md:gap-2 min-w-0 text-sm text-gray-500 font-medium">
              al
              <input type="date" name="hasta" defaultValue={params.hasta} className={`${inputCls} w-full min-w-0 md:w-auto`} />
            </label>
          </div>
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-2 px-5 py-3 md:py-2.5 bg-[#003366] text-white text-base font-medium rounded-lg hover:bg-[#002244] transition-colors"
          >
            Aplicar
          </button>
        </form>

        <div className={FILA_CHIPS}>
          <span className={ROTULO}>Cobranza:</span>
          <div className={CHIPS}>
          {ESTADOS.map(e => {
            const activo = params.estado === e
            return (
              <a
                key={e}
                href={buildUrl({ estado: activo ? undefined : e })}
                className={`${chipBase} ${activo ? `${cobranzaColor(e)} border-transparent` : chipInactivo}`}
              >
                {cobranzaLabel(e)}
              </a>
            )
          })}
          </div>
        </div>

        <div className={FILA_CHIPS}>
          <span className={ROTULO}>Plaza:</span>
          <div className={CHIPS}>
          {SUCURSALES.map(s => {
            const activo = params.sucursal === s.clave
            return (
              <a
                key={s.clave}
                href={buildUrl({ sucursal: activo ? undefined : s.clave })}
                className={`${chipBase} ${activo ? chipAzul : chipInactivo}`}
              >
                {s.nombre}
              </a>
            )
          })}
          </div>
        </div>

        <div className={FILA_CHIPS}>
          <span className={ROTULO}>Forma de pago:</span>
          <div className={CHIPS}>
          {FORMAS_PAGO.map(f => {
            const activo = params.forma === f.valor
            return (
              <a
                key={f.valor}
                href={buildUrl({ forma: activo ? undefined : f.valor })}
                className={`${chipBase} ${activo ? chipAzul : chipInactivo}`}
              >
                {f.label}
              </a>
            )
          })}
          </div>
        </div>

        <div className={FILA_CHIPS}>
          <span className={ROTULO}>Factura:</span>
          <div className={CHIPS}>
          <a
            href={buildUrl({ factura: params.factura === 'si' ? undefined : 'si' })}
            className={`${chipBase} ${params.factura === 'si' ? 'bg-emerald-500 text-white border-emerald-500' : chipInactivo}`}
          >
            Facturadas
          </a>
          <a
            href={buildUrl({ factura: params.factura === 'no' ? undefined : 'no' })}
            className={`${chipBase} ${params.factura === 'no' ? 'bg-amber-500 text-white border-amber-500' : chipInactivo}`}
          >
            Sin factura
          </a>
          </div>
        </div>
      </div>

      {todas.length === TOPE && (
        <p className="text-sm text-gray-400 mb-3">
          Se muestran las {TOPE} ventas más recientes. Acota con las fechas para ver periodos anteriores.
        </p>
      )}

      {/* Escritorio: la tabla completa. */}
      <div className="hidden lg:block bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-base min-w-[1250px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Folio</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Fecha</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Cliente</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Plaza</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Total</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Pagado</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Saldo</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Cobranza</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Factura</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Canal</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Registró</th>
                <th className="px-5 py-4" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={12} className="text-center py-20 text-gray-400 text-base">
                    Sin ventas con estos filtros.
                  </td>
                </tr>
              )}
              {rows.map((v: VentaCobranza) => {
                const plaza = v.sucursal
                const saldo = Number(v.saldo ?? 0)
                return (
                  <tr key={v.venta_id} className="hover:bg-gray-50/60 transition-colors">
                    <td className="px-5 py-4">
                      <Link
                        href={`/ventas/${v.venta_id}`}
                        className="font-semibold text-[#003366] hover:underline whitespace-nowrap"
                      >
                        {v.folio ?? 'Sin folio'}
                      </Link>
                      {atraso(v) && (
                        <div className="text-sm text-red-600 mt-0.5">{atraso(v)}</div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-gray-700 whitespace-nowrap">{formatDia(v.fecha)}</td>
                    <td className="px-5 py-4">
                      <div className="font-medium text-gray-900">
                        {clienteTitulo(v)}
                      </div>
                      {v.cliente_empresa && v.cliente_nombre && (
                        <div className="text-sm text-gray-500 mt-0.5">{v.cliente_nombre}</div>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      {plaza ? (
                        <span
                          className={`text-sm font-semibold px-2.5 py-1 rounded-md whitespace-nowrap ${plazaColor(plaza)}`}
                        >
                          {plaza}
                        </span>
                      ) : (
                        <span className="text-sm text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4 font-semibold text-gray-900 whitespace-nowrap">{pesos(v.total)}</td>
                    <td className="px-5 py-4 text-gray-600 whitespace-nowrap">{pesos(v.pagado)}</td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      <span className={`font-semibold ${saldo > 0 ? 'text-gray-900' : 'text-emerald-600'}`}>
                        {pesos(saldo)}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-block text-sm font-semibold px-2.5 py-1 rounded-md whitespace-nowrap ${cobranzaColor(v.estado_cobranza)}`}
                      >
                        {cobranzaLabel(v.estado_cobranza)}
                      </span>
                      <div className="text-sm text-gray-400 mt-1 whitespace-nowrap">
                        {formaDetalle(v)}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      {v.factura_uuid ? (
                        <span
                          title={v.factura_uuid}
                          className="font-mono text-sm text-gray-600 whitespace-nowrap"
                        >
                          {v.factura_uuid.slice(0, 8).toUpperCase()}…
                        </span>
                      ) : v.requiere_factura ? (
                        <span className="text-sm font-medium text-amber-600 whitespace-nowrap">Falta timbrar</span>
                      ) : (
                        <span className="text-sm text-gray-400">—</span>
                      )}
                      {v.factura_emisor && (
                        <div className="text-sm text-gray-400 capitalize mt-0.5">{v.factura_emisor}</div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-gray-500 text-sm whitespace-nowrap">
                      {CANALES[v.canal] ?? v.canal ?? '—'}
                    </td>
                    <td className="px-5 py-4 text-gray-500 text-sm whitespace-nowrap">{v.usuario ?? '—'}</td>
                    <td className="px-5 py-4">
                      <Link
                        href={`/ventas/${v.venta_id}`}
                        className="text-sm font-medium text-[#003366] hover:underline whitespace-nowrap"
                      >
                        Ver detalle
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Teléfono y tablet: una tarjeta por venta; toda la tarjeta abre el detalle. */}
      <div className="lg:hidden">
        {rows.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-xl text-center py-16 text-gray-400 text-base">
            Sin ventas con estos filtros.
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {rows.map((v: VentaCobranza) => {
            const saldo = Number(v.saldo ?? 0)
            const cancelada = v.estado_cobranza === 'cancelada'
            return (
              <Link
                key={v.venta_id}
                href={`/ventas/${v.venta_id}`}
                className="block bg-white border border-gray-200 rounded-xl p-4 hover:border-gray-300 active:bg-gray-50 transition-colors min-w-0"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-[#003366] break-all">{v.folio ?? 'Sin folio'}</div>
                    <div className="font-medium text-gray-900 mt-0.5 break-words">{clienteTitulo(v)}</div>
                    {v.cliente_empresa && v.cliente_nombre && (
                      <div className="text-sm text-gray-500 break-words">{v.cliente_nombre}</div>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className={`font-semibold whitespace-nowrap ${cancelada ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                      {pesos(v.total)}
                    </div>
                    <span
                      className={`inline-block mt-1 text-sm font-semibold px-2.5 py-1 rounded-md whitespace-nowrap ${cobranzaColor(v.estado_cobranza)}`}
                    >
                      {cobranzaLabel(v.estado_cobranza)}
                    </span>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-500">
                  <span className="whitespace-nowrap">{formatDia(v.fecha)}</span>
                  {v.sucursal && (
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${plazaColor(v.sucursal)}`}>
                      {v.sucursal}
                    </span>
                  )}
                  <span>· {formaDetalle(v)}</span>
                </div>

                <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
                  {!cancelada && (
                    <span className={`font-semibold ${saldo > 0 ? 'text-gray-900' : 'text-emerald-600'}`}>
                      Saldo {pesos(saldo)}
                    </span>
                  )}
                  {atraso(v) && <span className="text-red-600 font-medium">{atraso(v)}</span>}
                  {v.factura_uuid ? (
                    <span className="font-mono text-gray-500">Fact. {v.factura_uuid.slice(0, 8).toUpperCase()}…</span>
                  ) : v.requiere_factura ? (
                    <span className="font-medium text-amber-600">Falta timbrar</span>
                  ) : null}
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
