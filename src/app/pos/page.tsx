import { sql, faltaMigracion } from '@/lib/db'
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
  const [sucursal, { data: sucursales }, usuariosRes] = await Promise.all([
    resolverSucursal(),
    sql<{ id: string; clave: string; nombre: string }>(
      `select id, clave, nombre from sucursales
        where activo order by es_matriz desc, clave`
    ),
    sql<UsuarioPanel>(
      `select id, nombre, iniciales, rol, sucursal_id, activo
         from usuarios_panel where activo order by nombre`
    ),
  ])

  const usuarios = usuariosRes.data

  // Sin la base preparada no hay `usuarios_panel`, el selector de cajero
  // sale vacío y no se puede cobrar. Antes fallaba callado y parecía que el
  // POS estaba roto; ahora dice qué falta.
  if (usuariosRes.error) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Punto de venta</h1>
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-5 mt-6 text-base">
          {usuariosRes.error.message}
          {faltaMigracion(usuariosRes.error.message) && (
            <p className="mt-2 text-sm">
              Falta preparar la base. En esa computadora corre{' '}
              <code className="font-mono">instalacion\instalar-base.ps1</code>.
              Sin eso no existen las ventas, los movimientos ni el control de lotes.
            </p>
          )}
        </div>
      </div>
    )
  }

  if (!sucursal) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Punto de venta</h1>
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-5 mt-6 text-base">
          No hay ninguna plaza dada de alta. El inventario es por plaza, así que sin
          eso no se puede vender.
          <p className="mt-2 text-sm">
            Falta preparar la base. En esa computadora corre{' '}
            <code className="font-mono">instalacion\instalar-base.ps1</code>.
          </p>
        </div>
      </div>
    )
  }

  return (
    <POSClient
      sucursal={sucursal}
      sucursales={sucursales}
      usuarios={usuarios}
      usuario={usuarioActual()}
    />
  )
}
