'use client'

// El botón que mete la mercancía al almacén (minuta 26).
//
// Hasta que no se aprieta, la compra es sólo papel: no hay existencias
// nuevas. Al recibirla, `recibir_compra` crea el lote de cada partida y
// deja el asiento en el kardex.

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/20/solid'
import type { EstadoCompra } from '@/lib/types'
import { recibirCompra } from '../acciones'

export default function RecibirCompra({
  compraId,
  estado,
  partidasSinLigar,
}: {
  compraId: string
  estado: EstadoCompra
  partidasSinLigar: string[]
}) {
  const router = useRouter()
  const [pendiente, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const bloqueado = partidasSinLigar.length > 0

  const recibir = () => {
    setError(null)
    startTransition(async () => {
      const r = await recibirCompra(compraId)
      if (!r.ok) { setError(r.error); return }
      router.refresh()
    })
  }

  if (estado === 'recibida') {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-5 lg:sticky lg:top-4 space-y-3">
        <div className="flex items-start gap-2 text-emerald-800">
          <CheckCircleIcon className="w-5 h-5 shrink-0 mt-0.5" />
          <span className="text-base">
            La mercancía ya entró al almacén. Los lotes están en inventario.
          </span>
        </div>
        <Link
          href={`/movimientos?referencia=${compraId}`}
          className="block text-base font-medium text-[#003366] hover:underline"
        >
          Ver los movimientos que generó →
        </Link>
      </div>
    )
  }

  if (estado === 'cancelada') {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-5 text-base text-gray-500 lg:sticky lg:top-4">
        Esta compra está cancelada.
      </div>
    )
  }

  return (
    <div className="space-y-4 lg:sticky lg:top-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-base flex items-start gap-2">
          <ExclamationTriangleIcon className="w-5 h-5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
        <h3 className="text-lg font-semibold text-gray-900">Recibir mercancía</h3>
        <p className="text-base text-gray-600">
          Da entrada a cada partida creando su lote. A partir de ahí ya se puede vender.
        </p>

        {bloqueado ? (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <p className="text-base text-amber-900 font-medium">
              Faltan {partidasSinLigar.length} partidas por ligar al catálogo:
            </p>
            <ul className="mt-1.5 text-sm text-amber-800 list-disc list-inside space-y-0.5">
              {partidasSinLigar.slice(0, 5).map((d, i) => <li key={i}>{d}</li>)}
              {partidasSinLigar.length > 5 && <li>y {partidasSinLigar.length - 5} más</li>}
            </ul>
            <p className="mt-2 text-sm text-amber-800">
              Vuelve a capturar la compra ligándolas, o da de alta esos productos en Inventario.
            </p>
          </div>
        ) : (
          <button
            onClick={recibir}
            disabled={pendiente}
            className="w-full px-5 py-3.5 bg-[#003366] text-white text-base font-semibold rounded-lg hover:bg-[#002244] disabled:opacity-50 transition-colors"
          >
            {pendiente ? 'Recibiendo…' : 'Recibir mercancía'}
          </button>
        )}
      </div>
    </div>
  )
}
