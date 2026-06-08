// Lógica pura del cotizador inteligente: ranking de opciones de compra y
// resolución de margen. Sin React ni Supabase → fácil de probar y reusar.

import type { OpcionCompra, Margen, TipoCliente } from './types'

// Margen base cuando ninguna regla aplica (15%). Ajustable.
export const MARGEN_BASE = 0.15

// Una opción de inventario propio con caducidad dentro de esta ventana
// se prioriza para sacar stock antes de que venza.
export const DIAS_CADUCIDAD_PRIORITARIA = 90

function diasHasta(fechaISO: string | null): number {
  if (!fechaISO) return Infinity
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const f = new Date(fechaISO + 'T00:00:00')
  return Math.round((f.getTime() - hoy.getTime()) / 86400000)
}

// ¿Es inventario propio que urge mover (próximo a caducar y aún vigente)?
function inventarioUrgente(o: OpcionCompra): boolean {
  if (o.origen !== 'inventario') return false
  const d = diasHasta(o.caducidad)
  return d >= 0 && d <= DIAS_CADUCIDAD_PRIORITARIA
}

// Ordena las opciones, la mejor primero. Criterios (los 4 que pediste):
//   1. Disponibilidad: lo que está en stock va antes.
//   2. Vender inventario propio próximo a caducar.
//   3. Menor costo.
// (El margen no afecta el orden de compra, solo el precio de venta.)
export function rankOpciones(opciones: OpcionCompra[]): OpcionCompra[] {
  return [...opciones].sort((a, b) => {
    const aStock = a.en_stock !== false
    const bStock = b.en_stock !== false
    if (aStock !== bStock) return aStock ? -1 : 1

    const aUrge = inventarioUrgente(a)
    const bUrge = inventarioUrgente(b)
    if (aUrge !== bUrge) return aUrge ? -1 : 1

    const ac = a.costo ?? Infinity
    const bc = b.costo ?? Infinity
    return ac - bc
  })
}

// Resuelve el margen para un producto/cliente. Gana la regla activa de
// mayor prioridad entre las que hacen match; empate → la más específica.
export function resolverMargen(
  margenes: Margen[],
  ctx: { tipo: TipoCliente | null; categoria: string | null; producto_id: string | null }
): number {
  const candidatas = margenes.filter(m =>
    m.activo &&
    (m.tipo_cliente == null || m.tipo_cliente === ctx.tipo) &&
    (m.categoria == null || m.categoria === ctx.categoria) &&
    (m.producto_id == null || m.producto_id === ctx.producto_id)
  )
  if (!candidatas.length) return MARGEN_BASE

  const especificidad = (m: Margen) =>
    (m.producto_id ? 4 : 0) + (m.categoria ? 2 : 0) + (m.tipo_cliente ? 1 : 0)

  candidatas.sort((a, b) =>
    b.prioridad - a.prioridad || especificidad(b) - especificidad(a)
  )
  return candidatas[0].margen_pct
}

export interface Sugerencia {
  opciones: OpcionCompra[]          // todas, ya rankeadas (1ª = recomendada)
  elegida: OpcionCompra | null      // la recomendada
  costo: number                     // costo de la elegida
  margen_pct: number                // margen aplicado
  precio_sugerido: number           // costo × (1 + margen)
}

// Combina ranking + margen para proponer un precio de venta por línea.
export function sugerir(
  opciones: OpcionCompra[],
  margenes: Margen[],
  ctx: { tipo: TipoCliente | null; categoria: string | null; producto_id: string | null }
): Sugerencia {
  const rankeadas = rankOpciones(opciones)
  const elegida = rankeadas[0] ?? null
  const margen_pct = resolverMargen(margenes, ctx)
  const costo = elegida?.costo ?? 0
  return {
    opciones: rankeadas,
    elegida,
    costo,
    margen_pct,
    precio_sugerido: Math.round(costo * (1 + margen_pct) * 100) / 100,
  }
}

// Precio de venta a partir de un costo y margen (al elegir otra opción a mano).
export function precioConMargen(costo: number, margen_pct: number): number {
  return Math.round(costo * (1 + margen_pct) * 100) / 100
}
