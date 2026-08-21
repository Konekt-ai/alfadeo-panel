'use client'

// Llenar el código de barras sin salir de la lista de inventario.
//
// El verificador (/verificador) es para pasar cajas por la pistola una por
// una. Esto es para cuando alguien ya está viendo la lista y quiere teclear
// el código de un producto puntual sin cambiar de pantalla.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckIcon, PencilIcon } from '@heroicons/react/20/solid'
import { registrarCodigo } from '../verificador/acciones'

export default function CodigoInline({ productoId }: { productoId: string }) {
  const [editando, setEditando] = useState(false)
  const [valor, setValor] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmar, setConfirmar] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const guardar = (forzar = false) => {
    setError(null)
    startTransition(async () => {
      const r = await registrarCodigo(productoId, valor, forzar)
      if (r.ok) {
        setEditando(false)
        setConfirmar(null)
        router.refresh()
        return
      }
      if ('confirmar' in r) {
        setConfirmar(r.confirmar)
        return
      }
      setError(r.error)
    })
  }

  if (!editando) {
    return (
      <button
        onClick={() => setEditando(true)}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-md hover:bg-amber-100 transition-colors"
      >
        <PencilIcon className="w-3.5 h-3.5" />
        Falta código
      </button>
    )
  }

  return (
    <div className="min-w-[180px]">
      <div className="flex items-center gap-1.5">
        <input
          autoFocus
          type="text"
          inputMode="numeric"
          value={valor}
          onChange={e => { setValor(e.target.value); setConfirmar(null); setError(null) }}
          onKeyDown={e => { if (e.key === 'Enter') guardar(); if (e.key === 'Escape') setEditando(false) }}
          placeholder="Escanea o teclea..."
          className="w-36 px-2 py-1 text-sm font-mono border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366]"
        />
        <button
          onClick={() => guardar()}
          disabled={isPending || !valor.trim()}
          className="p-1.5 rounded-md bg-[#003366] text-white disabled:opacity-40 hover:bg-[#002244] transition-colors"
          title="Guardar"
        >
          <CheckIcon className="w-4 h-4" />
        </button>
      </div>
      {error && <p className="text-xs text-red-600 mt-1 max-w-[220px]">{error}</p>}
      {confirmar && (
        <div className="text-xs text-amber-700 mt-1 max-w-[220px]">
          <p>{confirmar}</p>
          <button
            onClick={() => guardar(true)}
            disabled={isPending}
            className="mt-1 font-medium underline hover:no-underline"
          >
            Continuar de todos modos
          </button>
        </div>
      )}
    </div>
  )
}
