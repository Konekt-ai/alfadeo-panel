'use client'

// Botón de impresión del ticket, y el disparo automático cuando la página se
// abre con `?auto=1` desde el punto de venta.
//
// Se espera a que el navegador termine de pintar antes de llamar a print():
// si se llama de inmediato, Chrome a veces manda la hoja en blanco.

import { useEffect } from 'react'
import { PrinterIcon } from '@heroicons/react/20/solid'

export default function Autoimprimir({ auto }: { auto: boolean }) {
  useEffect(() => {
    if (!auto) return
    const t = setTimeout(() => window.print(), 350)
    return () => clearTimeout(t)
  }, [auto])

  return (
    <div className="no-print" style={{ textAlign: 'center', padding: '20px 16px 0' }}>
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex items-center gap-2 px-5 py-3 bg-[#003366] text-white text-base font-medium rounded-lg hover:bg-[#002244] transition-colors"
      >
        <PrinterIcon className="w-5 h-5" />
        Imprimir ticket
      </button>
      <p className="text-sm text-gray-500 mt-2">
        Elige la impresora <strong>POS-58</strong> y deja los márgenes en «Ninguno».
      </p>
    </div>
  )
}
