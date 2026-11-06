'use client'

// Menú ☰ para celular y tablet vertical. Abre el menú completo desde la
// izquierda, con las mismas secciones que la barra lateral de escritorio.

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Bars3Icon, XMarkIcon } from '@heroicons/react/24/outline'
import { ListaMenu } from './Sidebar'

export default function MenuMovil() {
  const [abierto, setAbierto] = useState(false)
  const path = usePathname()

  // Al navegar se cierra solo, también con el botón de atrás del teléfono.
  useEffect(() => { setAbierto(false) }, [path])

  // Mientras está abierto, la página de atrás no se desplaza y Esc lo cierra.
  useEffect(() => {
    if (!abierto) return
    const previo = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const alTeclear = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false) }
    window.addEventListener('keydown', alTeclear)
    return () => {
      document.body.style.overflow = previo
      window.removeEventListener('keydown', alTeclear)
    }
  }, [abierto])

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        aria-label="Abrir menú"
        aria-expanded={abierto}
        className="lg:hidden -ml-2 p-2 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
      >
        <Bars3Icon className="w-6 h-6" />
      </button>

      {abierto && (
        <div className="lg:hidden fixed inset-0 z-50" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40" onClick={() => setAbierto(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-[#003366] flex flex-col shadow-xl overflow-y-auto">
            <div className="h-14 flex items-center justify-between px-5 border-b border-white/10 shrink-0">
              <span className="text-white/60 text-xs font-semibold uppercase tracking-wider">Menú</span>
              <button
                type="button"
                onClick={() => setAbierto(false)}
                aria-label="Cerrar menú"
                className="-mr-2 p-2 rounded-lg text-white/70 hover:bg-white/10 transition-colors"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            <ListaMenu alElegir={() => setAbierto(false)} />
          </div>
        </div>
      )}
    </>
  )
}
