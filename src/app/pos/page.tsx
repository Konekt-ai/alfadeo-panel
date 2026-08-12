import { supabase } from '@/lib/supabase'
import { resolverSucursal, usuarioActual } from '@/lib/usuario'
import POSClient from './POSClient'
import type { UsuarioPanel } from '@/lib/types'

export const dynamic = 'force-dynamic'

// Punto de venta (minuta 11, 16). Es la prioridad declarada del cliente:
// hoy venden en Aspel y anotan las salidas en papel. Aquí la venta y el
// descuento de inventario son el mismo acto.
//
// Esta página sólo resuelve el contexto —quién cobra, en qué plaza— y se
// lo pasa al componente de cliente, que es donde vive la caja.
export default async function POSPage() {
  const [sucursal, { data: sucursales }, { data: usuarios }] = await Promise.all([
    resolverSucursal(),
    supabase.from('sucursales').select('id, clave, nombre')
      .eq('activo', true).order('es_matriz', { ascending: false }),
    supabase.from('usuarios_panel')
      .select('id, nombre, iniciales, rol, sucursal_id, activo')
      .eq('activo', true).order('nombre'),
  ])

  if (!sucursal) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Punto de venta</h1>
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-5 mt-6 text-base">
          No hay ninguna plaza dada de alta. El inventario es por plaza, así que sin
          eso no se puede vender.
          <p className="mt-2 text-sm">
            Falta correr <code className="font-mono">supabase/reunion-catalogo-sucursales.sql</code> en
            el SQL Editor de Supabase.
          </p>
        </div>
      </div>
    )
  }

  return (
    <POSClient
      sucursal={sucursal}
      sucursales={sucursales ?? []}
      usuarios={(usuarios ?? []) as UsuarioPanel[]}
      usuario={usuarioActual()}
    />
  )
}
