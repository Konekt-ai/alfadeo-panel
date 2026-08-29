// Alta de productos (punto 1 del cliente).
//
// La página sólo trae lo que el formulario necesita para no hacer esperar a
// quien está con la caja en la mano: las plazas, quién firma y las listas de
// laboratorios, categorías, formas y presentaciones que ya existen en el
// catálogo, para sugerirlas y no acabar con "PFIZER", "Pfizer" y "pfizer".

import Link from 'next/link'
import { ArrowLeftIcon } from '@heroicons/react/20/solid'
import { sql, faltaMigracion } from '@/lib/db'
import { resolverSucursal, usuarioActual } from '@/lib/usuario'
import FormNuevo, { type Sugerencias } from './FormNuevo'

export const dynamic = 'force-dynamic'

export default async function NuevoProductoPage() {
  const usuario = usuarioActual()
  const plaza = await resolverSucursal()

  const { data: sucursales, error: errorPlazas } = await sql<{
    id: string
    clave: string
    nombre: string
  }>(
    `select id, clave, nombre
       from sucursales
      where activo
      order by es_matriz desc, clave`
  )

  // Los cuatro catálogos en un solo viaje. `union` ya quita repetidos.
  const { data: valores, error: errorSug } = await sql<{ campo: string; valor: string }>(
    `select 'laboratorio'  as campo, laboratorio        as valor from productos where activo and laboratorio        is not null
      union
     select 'categoria',           categoria                    from productos where activo and categoria          is not null
      union
     select 'forma',               forma_farmaceutica           from productos where activo and forma_farmaceutica is not null
      union
     select 'presentacion',        presentacion                 from productos where activo and presentacion       is not null
      order by 1, 2`
  )

  const deCampo = (campo: string) => valores.filter(v => v.campo === campo).map(v => v.valor)

  const sugerencias: Sugerencias = {
    laboratorios: deCampo('laboratorio'),
    categorias: deCampo('categoria'),
    formas: deCampo('forma'),
    presentaciones: deCampo('presentacion'),
  }

  const error = errorPlazas ?? errorSug

  return (
    <div className="p-8">
      <Link
        href="/inventario"
        className="inline-flex items-center gap-1.5 text-base text-gray-400 hover:text-gray-600 mb-6"
      >
        <ArrowLeftIcon className="w-4 h-4" /> Inventario
      </Link>

      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Dar de alta un producto</h1>
        <p className="text-base text-gray-500 mt-1">
          Escanea la caja primero: si el código ya está en el catálogo, te lleva a ese producto en
          vez de crear un duplicado.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-6 text-base">
          {error.message}
          {faltaMigracion(error.message) && (
            <p className="mt-2 text-sm">
              Falta preparar la base. En esa computadora corre{' '}
              <code className="font-mono">instalacion\instalar-base.ps1</code>.
            </p>
          )}
        </div>
      )}

      <FormNuevo
        sucursales={sucursales}
        sucursalInicial={plaza?.id ?? sucursales[0]?.id ?? ''}
        usuario={usuario}
        sugerencias={sugerencias}
      />
    </div>
  )
}
