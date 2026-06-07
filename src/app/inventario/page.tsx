import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { PlusIcon, MagnifyingGlassIcon } from '@heroicons/react/20/solid'
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'

export const dynamic = 'force-dynamic'

export const UBICACIONES = [
  'RACK N1','RACK N2','RACK N3','RACK N4','RACK N5','RACK N6',
  'LOCKER N1','LOCKER N2','LOCKER N3','LOCKER N4',
  'REFRIGERADO','TARIMA',
]

export default async function InventarioPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; ubicacion?: string; vence?: string }>
}) {
  const params = await searchParams
  const hoy = new Date().toISOString().split('T')[0]
  const en30dias = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('inventario')
    .select('id, existencia, ubicacion, productos ( id, nombre, laboratorio, lote, caducidad )')
    .order('id', { ascending: false })

  let rows = (data ?? []).filter((r: any) => {
    if (params.ubicacion && r.ubicacion !== params.ubicacion) return false
    if (params.vence === '30') {
      const cad = r.productos?.caducidad
      if (!cad || cad < hoy || cad > en30dias) return false
    }
    if (params.vence === 'vencido') {
      const cad = r.productos?.caducidad
      if (!cad || cad >= hoy) return false
    }
    if (params.q) {
      const q = params.q.toLowerCase()
      return r.productos?.nombre?.toLowerCase().includes(q) ||
             r.productos?.laboratorio?.toLowerCase().includes(q) ||
             r.productos?.lote?.toLowerCase().includes(q)
    }
    return true
  })

  // Ordenar por nombre
  rows.sort((a: any, b: any) => (a.productos?.nombre ?? '').localeCompare(b.productos?.nombre ?? ''))

  const buildUrl = (o: Record<string, string | undefined>) => {
    const p = { q: params.q, ubicacion: params.ubicacion, vence: params.vence, ...o }
    const qs = Object.entries(p).filter(([,v]) => v).map(([k,v]) => `${k}=${encodeURIComponent(v!)}`).join('&')
    return `/inventario${qs ? `?${qs}` : ''}`
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Inventario</h1>
          <p className="text-sm text-gray-400 mt-0.5">{rows.length} productos</p>
        </div>
        <Link href="/inventario/nuevo"
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#003366] text-white text-sm font-medium rounded-lg hover:bg-[#002244] transition-colors">
          <PlusIcon className="w-4 h-4" />
          Agregar producto
        </Link>
      </div>

      {/* Buscador + filtros */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6 space-y-3">
        <form method="GET">
          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              name="q"
              defaultValue={params.q}
              placeholder="Buscar por nombre, laboratorio o lote..."
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366]"
            />
          </div>
        </form>
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-xs text-gray-400 mr-1">Ubicación:</span>
          {UBICACIONES.map(u => (
            <a key={u} href={buildUrl({ ubicacion: params.ubicacion === u ? undefined : u })}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                params.ubicacion === u
                  ? 'bg-[#003366] text-white border-[#003366]'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
              }`}>{u}</a>
          ))}
        </div>
        <div className="flex gap-2 items-center">
          <span className="text-xs text-gray-400 mr-1">Caducidad:</span>
          <a href={buildUrl({ vence: params.vence === '30' ? undefined : '30' })}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              params.vence === '30' ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
            }`}>Vence en 30 días</a>
          <a href={buildUrl({ vence: params.vence === 'vencido' ? undefined : 'vencido' })}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              params.vence === 'vencido' ? 'bg-red-500 text-white border-red-500' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
            }`}>Vencidos</a>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-6 text-sm">{error.message}</div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Producto</th>
              <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Laboratorio</th>
              <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Lote</th>
              <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Caducidad</th>
              <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Piezas</th>
              <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Ubicación</th>
              <th className="px-5 py-3.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.length === 0 && (
              <tr><td colSpan={7} className="text-center py-20 text-gray-300 text-sm">Sin resultados.</td></tr>
            )}
            {rows.map((r: any) => {
              const cad = r.productos?.caducidad
              const vencido = cad && cad < hoy
              const proxVencer = cad && cad >= hoy && cad <= en30dias
              return (
                <tr key={r.id} className="hover:bg-gray-50/60 transition-colors group">
                  <td className="px-5 py-4 font-medium text-gray-900">{r.productos?.nombre ?? '—'}</td>
                  <td className="px-5 py-4 text-gray-500">{r.productos?.laboratorio ?? '—'}</td>
                  <td className="px-5 py-4 font-mono text-xs text-gray-500">{r.productos?.lote ?? '—'}</td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex items-center gap-1 text-xs font-medium ${
                      vencido ? 'text-red-600' : proxVencer ? 'text-amber-600' : 'text-gray-600'
                    }`}>
                      {(vencido || proxVencer) && <ExclamationTriangleIcon className="w-3.5 h-3.5" />}
                      {cad ? new Date(cad + 'T12:00:00').toLocaleDateString('es-MX', { month: 'short', year: 'numeric' }) : '—'}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`font-semibold ${r.existencia === 0 ? 'text-red-500' : r.existencia < 10 ? 'text-amber-600' : 'text-gray-900'}`}>
                      {r.existencia}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded-md">
                      {r.ubicacion ?? '—'}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <Link href={`/inventario/${r.id}`}
                      className="text-xs font-medium text-[#003366] md:opacity-0 md:group-hover:opacity-100 transition-opacity hover:underline">
                      Editar
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}
