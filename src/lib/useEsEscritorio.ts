'use client'

// ¿La pantalla ya es de escritorio (lg, 1024px o más)?
//
// Sirve en los formularios que pintan el mismo campo dos veces: en la tabla
// de escritorio y en el bloque apilado del celular. Si las dos copias son
// `required`, el navegador valida también la que está oculta, no la puede
// enfocar y el formulario no se envía sin decir por qué. La copia que no se
// ve se deshabilita con esto, y deshabilitada no cuenta para la validación.
//
// Devuelve null hasta montar: en el servidor no se sabe el ancho.

import { useEffect, useState } from 'react'

export function useEsEscritorio(): boolean | null {
  const [es, setEs] = useState<boolean | null>(null)

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const cambiar = () => setEs(mq.matches)
    cambiar()
    mq.addEventListener('change', cambiar)
    return () => mq.removeEventListener('change', cambiar)
  }, [])

  return es
}
