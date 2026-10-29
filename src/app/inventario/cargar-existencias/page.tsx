import Link from 'next/link'
import { sql, faltaMigracion } from '@/lib/db'
import { usuarioActual } from '@/lib/usuario'
import { ArrowLeftIcon } from '@heroicons/react/20/solid'
import CargarExistencias from './CargarExistencias'

export const dynamic = 'force-dynamic'

export default async function CargarExistenciasPage() {
  const { data: plazas, error } = await sql<{ id: string; clave: string; nombre: string }>(
    `select id, clave, nombre from sucursales where activo order by es_matriz desc, clave`
  )

  return (
    <div className="p-8">
      <Link href="/inventario" className="inline-flex items-center gap-1.5 text-base text-gray-500 hover:text-gray-900 transition-colors mb-4">
        <ArrowLeftIcon className="w-4 h-4" />
        Inventario
      </Link>

      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Cargar conteo de inventario</h1>
        <p className="text-base text-gray-500 mt-1">
          Sube el Excel del conteo de almacén y cada lote queda con las piezas que dice el archivo.
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

      <CargarExistencias plazas={plazas} usuario={usuarioActual()} />

      <div className="mt-8 bg-white border border-gray-200 rounded-xl p-5 space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">Cómo funciona</h2>
        <ul className="text-base text-gray-600 list-disc list-inside space-y-1">
          <li>
            Si el lote ya existe en esa plaza y esa ubicación, se ajusta a lo contado. Si no existe,
            entra como lote nuevo.
          </li>
          <li>
            Todo queda en{' '}
            <Link href="/movimientos" className="text-[#003366] font-medium hover:underline">Movimientos</Link>{' '}
            como ajuste por conteo, con tu nombre y el nombre del archivo.
          </li>
          <li>
            <strong>Lo que no viene en el Excel no se toca.</strong> Para empezar desde cero, antes se
            corre <code className="font-mono text-sm">instalacion\existencias-en-cero.ps1</code> en la
            computadora de la empresa.
          </li>
          <li>Entra el archivo completo o no entra nada: si un renglón falla, no se carga ninguno.</li>
        </ul>
      </div>
    </div>
  )
}
