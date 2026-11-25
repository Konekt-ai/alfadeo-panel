'use client'

// Aviso del cobro: la venta lleva factura y al cliente le faltan RFC y
// razón social. Sin ellos FACTURE no puede timbrar, así que se capturan
// aquí mismo y quedan guardados en el cliente para la próxima vez.

import { useState, useTransition } from 'react'
import { ExclamationTriangleIcon } from '@heroicons/react/20/solid'
import { guardarDatosFiscalesPOS } from './acciones'

type ClienteGuardado = NonNullable<Awaited<ReturnType<typeof guardarDatosFiscalesPOS>>['cliente']>

export default function DatosFiscales({
  clienteId,
  rfcInicial,
  razonInicial,
  alGuardar,
}: {
  clienteId: string
  rfcInicial: string | null
  razonInicial: string | null
  alGuardar: (c: ClienteGuardado) => void
}) {
  const [rfc, setRfc] = useState(rfcInicial ?? '')
  const [razon, setRazon] = useState(razonInicial ?? '')
  const [error, setError] = useState<string | null>(null)
  const [guardando, startGuardar] = useTransition()

  const guardar = () => {
    setError(null)
    startGuardar(async () => {
      const r = await guardarDatosFiscalesPOS(clienteId, { rfc, razon_social: razon })
      if (r.error) { setError(r.error); return }
      if (r.cliente) alGuardar(r.cliente)
    })
  }

  const inputCls = 'w-full px-3 py-2.5 text-base border border-amber-200 bg-white rounded-lg focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366]'

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-3">
      <p className="flex items-start gap-2 text-sm text-amber-900">
        <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
        A este cliente le faltan datos para facturar. Captúralos y quedan guardados.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input
          value={rfc}
          onChange={e => setRfc(e.target.value.toUpperCase())}
          placeholder="RFC"
          aria-label="RFC"
          autoComplete="off"
          className={inputCls + ' font-mono uppercase'}
        />
        <input
          value={razon}
          onChange={e => setRazon(e.target.value)}
          placeholder="Razón social"
          aria-label="Razón social"
          autoComplete="off"
          className={inputCls}
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="button"
        onClick={guardar}
        disabled={guardando || !rfc.trim() || !razon.trim()}
        className="w-full sm:w-auto px-4 py-2.5 bg-[#003366] text-white text-base font-medium rounded-lg hover:bg-[#002244] disabled:opacity-50 transition-colors"
      >
        {guardando ? 'Guardando…' : 'Guardar datos fiscales'}
      </button>
    </div>
  )
}
