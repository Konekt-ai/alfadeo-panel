import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { PlusIcon, MagnifyingGlassIcon } from '@heroicons/react/20/solid'
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { UBICACIONES, SUCURSALES } from '@/lib/constantes'

export const dynamic = 'force-dynamic'

export default async function InventarioPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; ubicacion?: string; vence?: string; sucursal?: string }>
}) {
  const params = await searchParams
  const hoy = new Date().toISOString().split('T')[0]
  const en30dias = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('inventario')
    .select(`
      id, existencia, ubicacion,
      sucursales ( clave, nombre, ciudad ),
      productos ( id, nombre, nombre_comercial, nombre_generico, concentracion,
                  forma_farmaceutica, presentacion, laboratorio, lote, caducidad )
    `)
    .order('id', { ascending: false })

  let rows = (data ?? []).filter((r: any) => {
    if (params.ubicacion && r.ubicacion !== params.ubicacion) return false
    if (params.sucursal && r.sucursales?.clave !== params.sucursal) return false
    if (params.vence === '30') {
      const cad = r.productos?.caducidad
      if (!cad || cad < hoy || cad > en30dias) return false
    }
    if (params.vence === 'vencido') {
      const cad = r.productos?.caducidad
      if (!cad || cad >= hoy) return false
    }
    if (params.q) {
      // Se busca por nombre, empezando por el comercial: es como lo busca el
      // equipo en la vida real, no por código de barras.
      const q = params.q.toLowerCase()
      const p = r.productos ?? {}
      return [p.nombre_comercial, p.nombre_generico, p.nombre, p.laboratorio, p.lote]
        .some((campo: string | null) => campo?.toLowerCase().includes(q))
    }
    return true
  })

  // Ordenar por nombre comercial, que es el que se ve primero en la tabla.
  rows.sort((a: any, b: any) =>
    (a.productos?.nombre_comercial ?? a.productos?.nombre ?? '')
      .localeCompare(b.productos?.nombre_comercial ?? b.productos?.nombre ?? '')
  )

  const buildUrl = (o: Record<string, string | undefined>) => {
    const p = { q: params.q, ubicacion: params.ubicacion, vence: params.vence, sucursal: params.sucursal, ...o }
    const qs = Object.entries(p).filter(([,v]) => v).map(([k,v]) => `${k}=${encodeURIComponent(v!)}`).join('&')
    return `/inventario${qs ? `?${qs}` : ''}`
  }

  const chip = (activo: boolean, color = '#003366') =>
    `px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors ${
      activo
        ? 'text-white'
        : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
    }`

  const piezasTotales = rows.reduce((s: number, r: any) => s + Number(r.existencia ?? 0), 0)

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Inventario</h1>
          <p className="text-base text-gray-500 mt-1">
            {rows.length} registros · {piezasTotales.toLocaleString('es-MX')} piezas
          </p>
        </div>
        <Link href="/inventario/nuevo"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#003366] text-white text-base font-medium rounded-lg hover:bg-[#002244] transition-colors">
          <PlusIcon className="w-5 h-5" />
          Agregar producto
        </Link>
      </div>

      {/* Buscador + filtros */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6 space-y-4">
        <form method="GET">
          {/* Los filtros activos se conservan al buscar. */}
          {params.ubicacion && <input type="hidden" name="ubicacion" value={params.ubicacion} />}
          {params.sucursal && <input type="hidden" name="sucursal" value={params.sucursal} />}
          {params.vence && <input type="hidden" name="vence" value={params.vence} />}
          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              name="q"
              defaultValue={params.q}
              placeholder="Buscar por nombre comercial, genérico, laboratorio o lote..."
              className="w-full pl-11 pr-4 py-3 text-base border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366]"
            />
          </div>
        </form>

        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-sm text-gray-500 mr-1 font-medium">Plaza:</span>
          {SUCURSALES.map(s => (
            <a key={s.clave} href={buildUrl({ sucursal: params.sucursal === s.clave ? undefined : s.clave })}
              className={chip(params.sucursal === s.clave)}
              style={params.sucursal === s.clave ? { background: '#003366', borderColor: '#003366' } : undefined}>
              {s.nombre}
            </a>
          ))}
        </div>

        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-sm text-gray-500 mr-1 font-medium">Ubicación:</span>
          {UBICACIONES.map(u => (
            <a key={u} href={buildUrl({ ubicacion: params.ubicacion === u ? undefined : u })}
              className={chip(params.ubicacion === u)}
              style={params.ubicacion === u ? { background: '#003366', borderColor: '#003366' } : undefined}>
              {u}
            </a>
          ))}
        </div>

        <div className="flex gap-2 items-center flex-wrap">
          <span className="text-sm text-gray-500 mr-1 font-medium">Caducidad:</span>
          <a href={buildUrl({ vence: params.vence === '30' ? undefined : '30' })}
            className={`px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              params.vence === '30' ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
            }`}>Vence en 30 días</a>
          <a href={buildUrl({ vence: params.vence === 'vencido' ? undefined : 'vencido' })}
            className={`px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              params.vence === 'vencido' ? 'bg-red-500 text-white border-red-500' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
            }`}>Vencidos</a>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-6 text-base">
          {error.message}
          {/relationship|column/i.test(error.message) && (
            <p className="mt-2 text-sm">
              Falta correr <code className="font-mono">supabase/reunion-catalogo-sucursales.sql</code> en el SQL Editor de Supabase.
            </p>
          )}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-base min-w-[1000px]">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Producto</th>
              <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Miligramos</th>
              <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Presentación</th>
              <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Laboratorio</th>
              <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Lote</th>
              <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Caducidad</th>
              <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Piezas</th>
              <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Plaza</th>
              <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Ubicación</th>
              <th className="px-5 py-4" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.length === 0 && (
              <tr><td colSpan={10} className="text-center py-20 text-gray-400 text-base">Sin resultados.</td></tr>
            )}
            {rows.map((r: any) => {
              const p = r.productos ?? {}
              const cad = p.caducidad
              const vencido = cad && cad < hoy
              const proxVencer = cad && cad >= hoy && cad <= en30dias
              const plaza = r.sucursales?.clave
              return (
                <tr key={r.id} className="hover:bg-gray-50/60 transition-colors group">
                  {/* Comercial arriba, genérico abajo: así lo busca el equipo. */}
                  <td className="px-5 py-4">
                    <div className="font-semibold text-gray-900">
                      {p.nombre_comercial ?? p.nombre_generico ?? p.nombre ?? '—'}
                    </div>
                    {p.nombre_generico && p.nombre_generico !== p.nombre_comercial && (
                      <div className="text-sm text-gray-500 mt-0.5">
                        {p.nombre_generico}
                        {p.forma_farmaceutica && ` · ${p.forma_farmaceutica}`}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-4 text-gray-700 whitespace-nowrap">{p.concentracion ?? '—'}</td>
                  <td className="px-5 py-4 text-gray-700">{p.presentacion ?? '—'}</td>
                  <td className="px-5 py-4 text-gray-500">{p.laboratorio ?? '—'}</td>
                  <td className="px-5 py-4 font-mono text-sm text-gray-500">{p.lote ?? '—'}</td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex items-center gap-1.5 text-sm font-medium whitespace-nowrap ${
                      vencido ? 'text-red-600' : proxVencer ? 'text-amber-600' : 'text-gray-600'
                    }`}>
                      {(vencido || proxVencer) && <ExclamationTriangleIcon className="w-4 h-4" />}
                      {cad ? new Date(cad + 'T12:00:00').toLocaleDateString('es-MX', { month: 'short', year: 'numeric' }) : '—'}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`text-lg font-semibold ${
                      r.existencia === 0 ? 'text-red-500' : r.existencia < 10 ? 'text-amber-600' : 'text-gray-900'
                    }`}>
                      {r.existencia}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    {plaza ? (
                      <span className={`text-sm font-semibold px-2.5 py-1 rounded-md whitespace-nowrap ${
                        plaza === 'GDL' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'
                      }`}>
                        {plaza}
                      </span>
                    ) : (
                      <span className="text-sm text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <span className="text-sm font-medium text-gray-600 bg-gray-100 px-2.5 py-1 rounded-md whitespace-nowrap">
                      {r.ubicacion ?? '—'}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <Link href={`/inventario/${r.id}`}
                      className="text-sm font-medium text-[#003366] md:opacity-0 md:group-hover:opacity-100 transition-opacity hover:underline">
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
