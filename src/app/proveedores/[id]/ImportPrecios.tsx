'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUpTrayIcon, CheckCircleIcon, ExclamationCircleIcon } from '@heroicons/react/20/solid'

export default function ImportPrecios({ proveedorId }: { proveedorId: string }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [subiendo, setSubiendo] = useState(false)
  const [result, setResult] = useState<{ ok?: boolean; error?: string; insertados?: number; omitidas?: number } | null>(null)

  const subir = async () => {
    if (!file) return
    setSubiendo(true)
    setResult(null)
    try {
      const fd = new FormData()
      fd.set('file', file)
      const res = await fetch(`/api/proveedores/${proveedorId}/importar`, { method: 'POST', body: fd })
      const json = await res.json()
      setResult(json)
      if (json.ok) {
        setFile(null)
        if (inputRef.current) inputRef.current.value = ''
        router.refresh()
      }
    } catch {
      setResult({ error: 'Falló la subida. Revisa tu conexión e intenta de nuevo.' })
    } finally {
      setSubiendo(false)
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Importar lista de precios</h2>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={e => { setFile(e.target.files?.[0] ?? null); setResult(null) }}
          className="block text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200 file:cursor-pointer"
        />
        <button
          type="button"
          onClick={subir}
          disabled={!file || subiendo}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#003366] text-white text-sm font-medium rounded-lg hover:bg-[#002244] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          <ArrowUpTrayIcon className="w-4 h-4" />
          {subiendo ? 'Importando...' : 'Importar'}
        </button>
      </div>

      <p className="text-xs text-gray-400 mt-3 leading-relaxed">
        Acepta Excel (.xlsx, .xls) o CSV. Detecta solas las columnas por su encabezado:
        <span className="text-gray-500"> nombre/descripción, clave/SKU, precio/costo, existencia/stock, caducidad, EAN, laboratorio, presentación.</span>
        {' '}Las filas se identifican por la clave del proveedor; volver a importar actualiza precios sin perder los emparejamientos.
      </p>

      {result?.ok && (
        <div className="mt-3 flex items-start gap-2 bg-emerald-50 text-emerald-800 rounded-lg p-3 text-sm">
          <CheckCircleIcon className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            Importados <strong>{result.insertados}</strong> productos
            {result.omitidas ? <> · {result.omitidas} filas omitidas (sin datos)</> : null}.
          </span>
        </div>
      )}
      {result?.error && (
        <div className="mt-3 flex items-start gap-2 bg-red-50 text-red-700 rounded-lg p-3 text-sm">
          <ExclamationCircleIcon className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{result.error}</span>
        </div>
      )}
    </div>
  )
}
