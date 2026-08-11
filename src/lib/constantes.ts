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

// Motivos de un movimiento manual. Son los renglones que hoy se escriben
// a mano en la libreta de entradas y salidas (minuta 10).
export const MOTIVOS_ENTRADA = [
  'Compra a proveedor',
  'Devolución de cliente',
  'Ajuste por conteo físico',
  'Corrección de captura',
]

export const MOTIVOS_SALIDA = [
  'Venta mostrador',
  'Entrega a cliente',
  'Muestra médica',
  'Merma',
  'Caducado',
  'Ajuste por conteo físico',
]

export const FORMAS_PAGO = [
  { valor: 'efectivo',       label: 'Efectivo' },
  { valor: 'transferencia',  label: 'Transferencia' },
  { valor: 'tarjeta',        label: 'Tarjeta' },
  { valor: 'cheque',         label: 'Cheque' },
  { valor: 'credito',        label: 'Crédito' },
] as const

export const METODOS_PAGO = [
  { valor: 'transferencia', label: 'Transferencia' },
  { valor: 'efectivo',      label: 'Efectivo' },
  { valor: 'cheque',        label: 'Cheque' },
  { valor: 'tarjeta',       label: 'Tarjeta' },
  { valor: 'compensacion',  label: 'Compensación' },
] as const

// Plazos de crédito que ya manejan (minuta 34).
export const DIAS_CREDITO = [8, 10, 15, 30, 45, 60]

// Paqueterías con las que mueven mercancía (minuta 5).
export const PAQUETERIAS = ['DHL', 'Estafeta', 'FedEx', 'Paquetexpress', 'Entrega propia', 'Otra']
