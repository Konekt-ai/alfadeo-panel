// Constantes compartidas del panel.
//
// Viven aquí y no dentro de un page.tsx porque Next.js NO permite exports
// arbitrarios desde un archivo de página: `next build` falla con
// "Property 'X' is incompatible with index signature". Un page.tsx sólo puede
// exportar `default` y las claves que reconoce el framework (dynamic,
// metadata, revalidate, etc.).

// Posición FÍSICA dentro de la bodega. No confundir con la plaza.
export const UBICACIONES = [
  'RACK N1', 'RACK N2', 'RACK N3', 'RACK N4', 'RACK N5', 'RACK N6',
  'LOCKER N1', 'LOCKER N2', 'LOCKER N3', 'LOCKER N4',
  'REFRIGERADO', 'TARIMA',
]

// Plazas del grupo. Guadalajara es matriz y abastece a Monterrey.
export const SUCURSALES = [
  { clave: 'GDL', nombre: 'Guadalajara' },
  { clave: 'MTY', nombre: 'Monterrey' },
]
