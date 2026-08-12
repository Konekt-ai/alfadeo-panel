'use client'

// Lo que se hace sobre una venta ya cerrada (minuta 33, 36, 7).
//
// Las tres acciones viven en la misma columna porque son las tres que se
// piden desde el teléfono: "¿ya está facturada?", "cóbrala", "cancélala".

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/20/solid'
import { METODOS_PAGO } from '@/lib/constantes'
import { pesos } from '@/lib/utils'
import type { EstadoVenta } from '@/lib/types'
import { registrarFactura, cancelarVenta, registrarPago } from '../acciones'

const EMISORES = [
  { valor: 'interno',   label: 'Desde este sistema' },
  { valor: 'aspel',     label: 'Aspel' },
  { valor: 'contalink', label: 'Contalink' },
  { valor: 'otro',      label: 'Otro' },
]

type Aviso = { tipo: 'ok' | 'error'; texto: string } | null

export default function AccionesVenta({
  ventaId,
  estado,
  saldo,
  tieneFactura,
  tienePagos,
  facturaExterna,
}: {
  ventaId: string
  estado: EstadoVenta
  saldo: number
  tieneFactura: boolean
  tienePagos: boolean
  facturaExterna: string | null
}) {
  const router = useRouter()
  const [pendiente, startTransition] = useTransition()
  const [aviso, setAviso] = useState<Aviso>(null)
  const [abierto, setAbierto] = useState<'factura' | 'pago' | 'cancelar' | null>(null)

  // Factura. Si el cliente factura con su propio sistema, ese es el que se
  // propone: es el caso de Grajes con Contalink (minuta 36).
  const [emisor, setEmisor] = useState(facturaExterna ?? 'interno')
  const [serie, setSerie] = useState('')
  const [folio, setFolio] = useState('')
  const [uuid, setUuid] = useState('')

  const [monto, setMonto] = useState(saldo > 0 ? saldo.toFixed(2) : '')
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10))
  const [metodo, setMetodo] = useState<string>('transferencia')
  const [referencia, setReferencia] = useState('')

  const [motivo, setMotivo] = useState('')

  const cancelada = estado === 'cancelada'

  const correr = (fn: () => Promise<{ ok: true; mensaje: string } | { error: string }>) => {
    setAviso(null)
    startTransition(async () => {
      const r = await fn()
      if ('error' in r) { setAviso({ tipo: 'error', texto: r.error }); return }
      setAviso({ tipo: 'ok', texto: r.mensaje })
      setAbierto(null)
      router.refresh()
    })
  }

  const tarjeta = 'bg-white border border-gray-200 rounded-xl'
  const input = 'w-full px-4 py-3 text-base border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366]'
  const label = 'block text-sm font-semibold text-gray-500 uppercase tracking-wide mb-1.5'
  const btnPrimario = 'w-full px-5 py-3 bg-[#003366] text-white text-base font-medium rounded-lg hover:bg-[#002244] disabled:opacity-50 transition-colors'
  const btnSecundario = 'w-full px-5 py-3 border border-gray-300 text-gray-700 text-base font-medium rounded-lg hover:bg-gray-50 transition-colors'

  return (
    <div className="space-y-4 lg:sticky lg:top-4">
      {aviso && (
        <div className={`rounded-xl p-4 text-base flex items-start gap-2 ${
          aviso.tipo === 'ok'
            ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
            : 'bg-red-50 border border-red-200 text-red-700'
        }`}>
          {aviso.tipo === 'ok'
            ? <CheckCircleIcon className="w-5 h-5 shrink-0 mt-0.5" />
            : <ExclamationTriangleIcon className="w-5 h-5 shrink-0 mt-0.5" />}
          <span>{aviso.texto}</span>
        </div>
      )}

      {cancelada ? (
        <div className={`${tarjeta} p-5 text-base text-gray-500`}>
          Esta venta está cancelada. Las piezas ya regresaron a su lote.
        </div>
      ) : (
        <>
          {/* Registrar factura */}
          <div className={`${tarjeta} p-5`}>
            {abierto === 'factura' ? (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-900">Registrar factura</h3>
                <div>
                  <label className={label}>Quién timbró</label>
                  <select value={emisor} onChange={e => setEmisor(e.target.value)} className={input}>
                    {EMISORES.map(e => <option key={e.valor} value={e.valor}>{e.label}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={label}>Serie</label>
                    <input value={serie} onChange={e => setSerie(e.target.value)} className={input} placeholder="A" />
                  </div>
                  <div>
                    <label className={label}>Folio</label>
                    <input value={folio} onChange={e => setFolio(e.target.value)} className={input} placeholder="1234" />
                  </div>
                </div>
                <div>
                  <label className={label}>Folio fiscal (UUID)</label>
                  <input
                    value={uuid}
                    onChange={e => setUuid(e.target.value)}
                    className={`${input} font-mono text-sm`}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  />
                  <p className="text-sm text-gray-400 mt-1.5">Cópialo del PDF o del XML del CFDI.</p>
                </div>
                <div className="flex gap-2">
                  <button
                    disabled={pendiente}
                    onClick={() => correr(() => registrarFactura({ ventaId, emisor, serie, folio, uuid }))}
                    className={btnPrimario}
                  >
                    {pendiente ? 'Guardando…' : 'Guardar'}
                  </button>
                  <button onClick={() => setAbierto(null)} className={btnSecundario}>Cancelar</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setAbierto('factura')} className={btnPrimario}>
                {tieneFactura ? 'Corregir factura' : 'Registrar factura'}
              </button>
            )}
            {!tieneFactura && abierto !== 'factura' && (
              <p className="text-sm text-gray-500 mt-2">
                Sirve también para las que factura el cliente con su propio sistema.
              </p>
            )}
          </div>

          {/* Pago */}
          {saldo > 0.005 && (
            <div className={`${tarjeta} p-5`}>
              {abierto === 'pago' ? (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-gray-900">Registrar pago</h3>
                  <p className="text-base text-gray-500 -mt-2">Saldo pendiente: {pesos(saldo)}</p>
                  <div>
                    <label className={label}>Monto</label>
                    <input
                      type="number" step="0.01" min="0" value={monto}
                      onChange={e => setMonto(e.target.value)} className={input}
                    />
                  </div>
                  <div>
                    <label className={label}>Fecha</label>
                    <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} className={input} />
                  </div>
                  <div>
                    <label className={label}>Método</label>
                    <select value={metodo} onChange={e => setMetodo(e.target.value)} className={input}>
                      {METODOS_PAGO.map(m => <option key={m.valor} value={m.valor}>{m.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={label}>Referencia</label>
                    <input
                      value={referencia} onChange={e => setReferencia(e.target.value)}
                      className={input} placeholder="Clave de rastreo, folio bancario…"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      disabled={pendiente}
                      onClick={() => correr(() => registrarPago({ ventaId, monto, fecha, metodo, referencia }))}
                      className={btnPrimario}
                    >
                      {pendiente ? 'Guardando…' : 'Registrar'}
                    </button>
                    <button onClick={() => setAbierto(null)} className={btnSecundario}>Cancelar</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setAbierto('pago')} className={btnPrimario}>
                  Registrar pago · {pesos(saldo)}
                </button>
              )}
            </div>
          )}

          {/* Cancelar */}
          <div className={`${tarjeta} p-5`}>
            {abierto === 'cancelar' ? (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-900">Cancelar venta</h3>
                <p className="text-base text-gray-600">
                  Cada pieza regresa al lote del que salió y queda asentado en el kardex.
                </p>
                <div>
                  <label className={label}>Motivo</label>
                  <textarea
                    value={motivo} onChange={e => setMotivo(e.target.value)}
                    rows={2} className={input} placeholder="Por qué se cancela"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    disabled={pendiente}
                    onClick={() => correr(() => cancelarVenta({ ventaId, motivo }))}
                    className="w-full px-5 py-3 bg-red-600 text-white text-base font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                  >
                    {pendiente ? 'Cancelando…' : 'Sí, cancelar'}
                  </button>
                  <button onClick={() => setAbierto(null)} className={btnSecundario}>No</button>
                </div>
              </div>
            ) : (
              <>
                <button
                  onClick={() => setAbierto('cancelar')}
                  disabled={tienePagos}
                  className="w-full px-5 py-3 border border-red-200 text-red-700 text-base font-medium rounded-lg hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Cancelar venta
                </button>
                {tienePagos && (
                  <p className="text-sm text-gray-500 mt-2">
                    Tiene pagos aplicados. Hay que quitarlos antes de cancelar.
                  </p>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
