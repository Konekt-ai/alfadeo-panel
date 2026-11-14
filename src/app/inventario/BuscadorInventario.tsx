'use client'

// El buscador de Inventario, listo para la pistola.
//
// El lector teclea el código y manda Enter, que envía el formulario. Para
// que eso funcione sin tocar el mouse, en escritorio el campo queda enfocado
// al cargar y con su texto seleccionado: el siguiente escaneo reemplaza al
// anterior en vez de pegarse detrás.
//
// En el celular no se enfoca solo, igual que en el verificador: abriría el
// teclado encima de la lista.

import { useEffect, useRef } from 'react'
import { MagnifyingGlassIcon } from '@heroicons/react/20/solid'

export default function BuscadorInventario({ valor }: { valor: string }) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (window.matchMedia('(pointer: coarse)').matches) return
    // preventScroll: el campo está debajo del resumen y enfocarlo no debe
    // brincar la página hasta ahí.
    ref.current?.focus({ preventScroll: true })
    ref.current?.select()
  }, [valor])

  return (
    <div className="relative">
      <MagnifyingGlassIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
      <input
        ref={ref}
        // La key renueva el campo cuando cambia la búsqueda: un defaultValue
        // no se actualiza solo al navegar.
        key={valor}
        name="q"
        defaultValue={valor}
        onFocus={e => e.currentTarget.select()}
        autoComplete="off"
        placeholder="Escanea el código o busca por nombre, laboratorio o lote..."
        className="w-full pl-11 pr-4 py-3 text-base border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366]"
      />
    </div>
  )
}
