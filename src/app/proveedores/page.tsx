import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { ChevronRightIcon } from '@heroicons/react/20/solid'
import type { MetodoIngesta } from '@/lib/types'

export const dynamic = 'force-dynamic'

const metodoLabel: Record<MetodoIngesta, string> = {
  manual: 'Captura manual',
  import: 'Importación Excel',
  scrape: 'Portal (scraping)',
  api: 'API',
}

export default async function ProveedoresPage() {
  const { data: proveedores, error } = await supabase
    .from('proveedores')
    .select('*, proveedor_precios(count)')
    .order('nombre')

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-gray-900">Proveedores</h1>
        <p className="text-sm text-gray-400 mt-0.5">{proveedores?.length ?? 0} registrados</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-6 text-sm">
          Error al cargar: {error.message}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(proveedores ?? []).map((p: any) => {
          const numPrecios = p.proveedor_precios?.[0]?.count ?? 0
          return (
            <Link
              key={p.id}
              href={`/proveedores/${p.id}`}
              className="group bg-white border border-gray-200 rounded-xl p-5 hover:border-[#003366]/40 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <h2 className="font-semibold text-gray-900 truncate">{p.nombre}</h2>
                  <p className="text-xs text-gray-400 mt-0.5">{metodoLabel[p.metodo_ingesta as MetodoIngesta] ?? p.metodo_ingesta}</p>
                </div>
                <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  p.activo ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-400'
                }`}>
                  {p.activo ? 'Activo' : 'Inactivo'}
                </span>
              </div>

              <div className="mt-4 flex items-end justify-between">
                <div>
                  <div className="text-2xl font-semibold text-gray-900 tabular-nums">{numPrecios}</div>
                  <div className="text-xs text-gray-400">productos en catálogo</div>
                </div>
                <ChevronRightIcon className="w-5 h-5 text-gray-300 group-hover:text-[#003366] transition-colors" />
              </div>
            </Link>
          )
        })}

        {(!proveedores || proveedores.length === 0) && !error && (
          <div className="col-span-full text-center py-20 text-gray-300 text-sm">
            No hay proveedores registrados aún.
          </div>
        )}
      </div>
    </div>
  )
}
