import Link from 'next/link'
import { sql } from '@/lib/db'
import { resolverSucursal } from '@/lib/usuario'
import { ArrowLeftIcon } from '@heroicons/react/20/solid'
import CompraForm from './CompraForm'

export const dynamic = 'force-dynamic'

export default async function NuevaCompraPage() {
  const [sucursal, { data: sucursales }, { data: proveedores }] = await Promise.all([
    resolverSucursal(),
    sql<{ id: string; clave: string; nombre: string }>(
      `select id, clave, nombre from sucursales
        where activo order by es_matriz desc, clave`
    ),
    sql<{ id: string; nombre: string }>(
      `select id, nombre from proveedores where activo order by nombre`
    ),
  ])

  if (!sucursal) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Nueva compra</h1>
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-5 mt-6 text-base">
          No hay ninguna plaza dada de alta; la mercancía tiene que entrar a alguna.
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <Link href="/compras" className="inline-flex items-center gap-1.5 text-base text-gray-500 hover:text-gray-900 transition-colors mb-4">
        <ArrowLeftIcon className="w-4 h-4" />
        Compras
      </Link>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Nueva compra</h1>
        <p className="text-base text-gray-500 mt-1">
          Sube el XML de la factura del proveedor y se llena solo, o captúrala a mano.
        </p>
      </div>

      <CompraForm
        sucursalPorDefecto={sucursal.id}
        sucursales={sucursales ?? []}
        proveedores={proveedores ?? []}
      />
    </div>
  )
}
