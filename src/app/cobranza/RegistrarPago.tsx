'use client'

// Registrar un pago (minuta 30 y 32).
//
// Se usa igual desde el tablero y desde el estado de cuenta: se elige la
// venta a la que se aplica, se precarga el saldo y se captura la referencia
// bancaria. Hoy eso se revisa a mano en el correo del banco; aquí queda
// asentado con quién lo capturó y cuándo.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  BanknotesIcon, XMarkIcon, ExclamationTriangleIcon, CheckCircleIcon,
} from '@heroicons/react/20/solid'
import { METODOS_PAGO } from '@/lib/constantes'
import { pesos, formatDia } from '@/lib/utils'
import { fechaISO } from '@/lib/entrega'
import type { MetodoPago } from '@/lib/types'
import { registrarPago } from './acciones'

// Lo mínimo que el formulario necesita saber de cada venta con saldo.
export type VentaConSaldo = {
  venta_id: string
  folio: string | null
  fecha: string
  fecha_vencimiento: string | null
  total: number
  saldo: number
  dias_vencida: number
}

const CENTAVO = 0.01

export default function RegistrarPago({
  ventas,
  clienteNombre,
  ventaId,
  variante = 'primario',
  etiqueta = 'Registrar pago',
}: {
  /** Ventas del cliente que todavía deben algo. */
  ventas: VentaConSaldo[]
  clienteNombre?: string | null
  /** Venta que llega preseleccionada (desde una alerta o un renglón). */
  ventaId?: string
  variante?: 'primario' | 'enlace'
  etiqueta?: string
}) {
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [refrescando, startTransition] = useTransition()

  const [ventaSel, setVentaSel] = useState('')
  const [monto, setMonto] = useState('')
  const [fecha, setFecha] = useState('')
  const [metodo, setMetodo] = useState<MetodoPago>('transferencia')
  const [referencia, setReferencia] = useState('')
  const [notas, setNotas] = useState('')
  const [exceso, setExceso] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const venta = ventas.find(v => v.venta_id === ventaSel) ?? null
  const montoNum = Number(monto)
  const seExcede = !!venta && Number.isFinite(montoNum) && montoNum > venta.saldo + CENTAVO

  const elegirVenta = (id: string) => {
    setVentaSel(id)
    // El monto se precarga con el saldo: es lo que se cobra el 90% de las veces.
    const v = ventas.find(x => x.venta_id === id)
    setMonto(v ? v.saldo.toFixed(2) : '')
    setExceso(false)
    setError(null)
  }

  const abrir = () => {
    const inicial = (ventaId && ventas.some(v => v.venta_id === ventaId))
      ? ventaId
      : (ventas[0]?.venta_id ?? '')
    const v = ventas.find(x => x.venta_id === inicial)
    setVentaSel(inicial)
    setMonto(v ? v.saldo.toFixed(2) : '')
    // La fecha se calcula al abrir y no al montar: evita que el servidor y el
    // navegador rendericen días distintos por zona horaria.
    setFecha(fechaISO(new Date()))
    setMetodo('transferencia')
    setReferencia('')
    setNotas('')
    setExceso(false)
    setError(null)
    setOk(null)
    setAbierto(true)
  }

  const cerrar = () => {
    if (guardando) return
    setAbierto(false)
  }

  const guardar = async () => {
    setError(null)

    if (!venta) {
      setError('Elige la venta a la que se aplica el pago.')
      return
    }
    if (!Number.isFinite(montoNum) || montoNum <= 0) {
      setError('Captura un monto mayor a cero.')
      return
    }
    if (!fecha) {
      setError('Captura la fecha en que entró el pago.')
      return
    }
    // Aviso claro antes de dejar pasar un pago de más: se bloquea hasta que
    // el usuario marque la casilla de confirmación.
    if (seExcede && !exceso) {
      setError(
        `El pago de ${pesos(montoNum)} se pasa ${pesos(montoNum - venta.saldo)} ` +
        `del saldo de la venta ${venta.folio ?? 'sin folio'} (${pesos(venta.saldo)}). ` +
        'Corrige el monto o confirma abajo que sí depositaron de más.'
      )
      return
    }

    setGuardando(true)
    const res = await registrarPago({
      venta_id: venta.venta_id,
      monto: montoNum,
      fecha,
      metodo,
      referencia,
      notas,
      permitir_exceso: exceso,
    })
    setGuardando(false)

    if (!res.ok) {
      setError(res.error)
      return
    }

    setOk(res.mensaje)
    startTransition(() => router.refresh())
  }

  const inputCls =
    'w-full px-4 py-3 text-base border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366]'
  const labelCls = 'block text-sm font-medium text-gray-500 mb-1.5'

  const sinVentas = ventas.length === 0

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        disabled={sinVentas}
        title={sinVentas ? 'Este cliente no tiene ventas con saldo.' : undefined}
        className={
          variante === 'primario'
            ? 'inline-flex items-center gap-2 px-5 py-2.5 bg-[#003366] text-white text-base font-medium rounded-lg hover:bg-[#002244] transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
            : 'inline-flex items-center gap-1.5 text-sm font-medium text-[#003366] hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed'
        }
      >
        <BanknotesIcon className={variante === 'primario' ? 'w-5 h-5' : 'w-4 h-4'} />
        {etiqueta}
      </button>

      {abierto && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center sm:p-6"
          onClick={cerrar}
        >
          {/* Hoja desde abajo en celular, ventana centrada en escritorio: lo
              usan mucho desde el teléfono (minuta 11). */}
          <div
            className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-xl max-h-[92vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 border-b border-gray-100">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Registrar pago</h2>
                {clienteNombre && (
                  <p className="text-base text-gray-500 mt-0.5">{clienteNombre}</p>
                )}
              </div>
              <button
                type="button"
                onClick={cerrar}
                className="p-2 -mr-2 text-gray-400 hover:text-gray-600 transition-colors"
                aria-label="Cerrar"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>

            {ok ? (
              <div className="p-6 space-y-5">
                <div className="flex items-start gap-2.5 bg-emerald-50 text-emerald-800 rounded-xl p-4 text-base">
                  <CheckCircleIcon className="w-5 h-5 mt-0.5 shrink-0" />
                  <span>{ok}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setAbierto(false)}
                  className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 bg-[#003366] text-white text-base font-medium rounded-lg hover:bg-[#002244] transition-colors"
                >
                  {refrescando ? 'Actualizando...' : 'Listo'}
                </button>
              </div>
            ) : (
              <div className="p-6 space-y-5">
                <div>
                  <label className={labelCls} htmlFor="pago-venta">Venta a la que se aplica *</label>
                  <select
                    id="pago-venta"
                    value={ventaSel}
                    onChange={e => elegirVenta(e.target.value)}
                    className={`${inputCls} bg-white`}
                  >
                    {ventas.map(v => (
                      <option key={v.venta_id} value={v.venta_id}>
                        {(v.folio ?? 'Sin folio')} · {formatDia(v.fecha)} · saldo {pesos(v.saldo)}
                        {v.dias_vencida > 0 ? ` · ${v.dias_vencida} días de atraso` : ''}
                      </option>
                    ))}
                  </select>
                  {venta && (
                    <p className="text-sm text-gray-500 mt-1.5">
                      Total {pesos(venta.total)} · saldo {pesos(venta.saldo)} ·{' '}
                      {venta.fecha_vencimiento
                        ? `vence ${formatDia(venta.fecha_vencimiento)}`
                        : 'sin fecha de vencimiento'}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls} htmlFor="pago-monto">Monto *</label>
                    <input
                      id="pago-monto"
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      value={monto}
                      onChange={e => { setMonto(e.target.value); setError(null) }}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="pago-fecha">Fecha del pago *</label>
                    <input
                      id="pago-fecha"
                      type="date"
                      value={fecha}
                      onChange={e => setFecha(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls} htmlFor="pago-metodo">Método *</label>
                    <select
                      id="pago-metodo"
                      value={metodo}
                      onChange={e => setMetodo(e.target.value as MetodoPago)}
                      className={`${inputCls} bg-white`}
                    >
                      {METODOS_PAGO.map(m => (
                        <option key={m.valor} value={m.valor}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="pago-referencia">Referencia bancaria</label>
                    <input
                      id="pago-referencia"
                      type="text"
                      value={referencia}
                      onChange={e => setReferencia(e.target.value)}
                      placeholder="Clave de rastreo, folio o cheque"
                      className={inputCls}
                    />
                  </div>
                </div>

                <div>
                  <label className={labelCls} htmlFor="pago-notas">Notas</label>
                  <textarea
                    id="pago-notas"
                    rows={2}
                    value={notas}
                    onChange={e => setNotas(e.target.value)}
                    placeholder="Ej. depósito parcial, pendiente el resto para el viernes"
                    className={inputCls}
                  />
                </div>

                {seExcede && venta && (
                  <label className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={exceso}
                      onChange={e => { setExceso(e.target.checked); setError(null) }}
                      className="mt-1 w-5 h-5 accent-[#003366]"
                    />
                    <span className="text-base text-amber-900">
                      <strong className="block">Este pago se pasa del saldo.</strong>
                      El saldo es {pesos(venta.saldo)} y se están aplicando{' '}
                      {pesos(montoNum)}: {pesos(montoNum - venta.saldo)} de más.
                      Confirmo que sí se depositó esa cantidad y queda a favor del cliente.
                    </span>
                  </label>
                )}

                {error && (
                  <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-base">
                    <ExclamationTriangleIcon className="w-5 h-5 mt-0.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <div className="flex flex-col-reverse sm:flex-row gap-3 pt-1">
                  <button
                    type="button"
                    onClick={cerrar}
                    className="px-5 py-3 text-base font-medium text-gray-500 hover:text-gray-700 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={guardar}
                    disabled={guardando}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 bg-[#003366] text-white text-base font-medium rounded-lg hover:bg-[#002244] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <BanknotesIcon className="w-5 h-5" />
                    {guardando ? 'Guardando...' : 'Guardar pago'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
