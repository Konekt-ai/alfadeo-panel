import Link from 'next/link'
import { sql, faltaMigracion } from '@/lib/db'
import { usuarioActual } from '@/lib/usuario'
import { ArrowLeftIcon } from '@heroicons/react/20/solid'
import ImportarMovimientos from './ImportarMovimientos'

export const dynamic = 'force-dynamic'

export default async function ImportarMovimientosPage() {
  const { data: plazas, error } = await sql<{ id: string; clave: string; nombre: string; rfc: string | null }>(
    `select id, clave, nombre, rfc from sucursales where activo order by es_matriz desc, clave`
  )
  // Con los RFC de la empresa se sabe si una factura la emitimos nosotros
  // (salida) o un proveedor (entrada).
  const rfcsPropios = Array.from(new Set(plazas.map(p => p.rfc).filter((r): r is string => !!r)))

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <Link href="/movimientos" className="inline-flex items-center gap-1.5 text-base text-gray-500 hover:text-gray-900 transition-colors mb-4">
        <ArrowLeftIcon className="w-4 h-4" />
        Movimientos
      </Link>

      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Importar entradas y salidas</h1>
        <p className="text-base text-gray-500 mt-1">
          Registra muchos movimientos de una vez desde un Excel o desde el XML de una factura.
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

      <ImportarMovimientos
        plazas={plazas.map(({ id, clave, nombre }) => ({ id, clave, nombre }))}
        usuario={usuarioActual()}
        rfcsPropios={rfcsPropios}
      />

      <div className="mt-8 bg-white border border-gray-200 rounded-xl p-4 sm:p-5 space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">Cómo funciona</h2>
        <ul className="text-base text-gray-600 list-disc list-inside space-y-1">
          <li>Cada renglón queda en Movimientos con tu nombre, como si se hubiera capturado a mano.</li>
          <li>Una salida sin lote sale del lote que caduca primero; si no alcanza la existencia, no se aplica nada.</li>
          <li>Entra el archivo completo o no entra nada: si un renglón falla, no se aplica ninguno.</li>
          <li>
            <strong>No se aplica dos veces:</strong> el panel reconoce un archivo que ya se subió (aunque se
            haya vuelto a guardar) y una factura que ya entró por Compras o que es de una venta.
          </li>
        </ul>
      </div>
    </div>
  )
}
