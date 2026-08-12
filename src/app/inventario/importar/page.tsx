import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { ArrowLeftIcon } from '@heroicons/react/20/solid'
import ImportadorAspel from './ImportadorAspel'

export const dynamic = 'force-dynamic'

export default async function ImportarPage() {
  // Cuántos productos siguen sin código de barras. Es el número que dice si
  // el escaneo del POS ya sirve o todavía no (minuta 22).
  const [{ count: total }, { count: conCodigo }] = await Promise.all([
    supabase.from('productos').select('id', { count: 'exact', head: true }),
    supabase.from('productos').select('id', { count: 'exact', head: true }).not('codigo_barras', 'is', null),
  ])

  const sinCodigo = (total ?? 0) - (conCodigo ?? 0)

  return (
    <div className="p-8">
      <Link href="/inventario" className="inline-flex items-center gap-1.5 text-base text-gray-500 hover:text-gray-900 transition-colors mb-4">
        <ArrowLeftIcon className="w-4 h-4" />
        Inventario
      </Link>

      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Importar de Aspel</h1>
        <p className="text-base text-gray-500 mt-1">
          Trae el catálogo y, sobre todo, los códigos de barras que ya tienen cargados allá.
        </p>
      </div>

      {sinCodigo > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-6">
          <p className="text-base text-amber-900">
            <strong>{sinCodigo} de {total} productos no tienen código de barras.</strong> Mientras
            sigan así, la pistola del punto de venta no los va a encontrar y hay que buscarlos
            por nombre.
          </p>
        </div>
      )}

      <ImportadorAspel />

      <div className="mt-8 bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Qué NO hace esta pantalla</h2>
        <p className="text-base text-gray-600">
          No toca existencias. Las entradas y salidas se registran en{' '}
          <Link href="/movimientos" className="text-[#003366] font-medium hover:underline">Movimientos</Link>{' '}
          o al recibir una{' '}
          <Link href="/compras" className="text-[#003366] font-medium hover:underline">compra</Link>,
          porque ahí queda asentado quién movió qué y cuándo. Una importación que pisara
          existencias borraría ese rastro sin dejar nada en el kardex.
        </p>
      </div>
    </div>
  )
}
