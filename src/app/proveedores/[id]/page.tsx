import { supabase } from '@/lib/supabase'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { ArrowLeftIcon, MagnifyingGlassIcon } from '@heroicons/react/20/solid'
import type { Proveedor, ProveedorPrecio, MetodoIngesta, EstadoMatch } from '@/lib/types'
import ImportPrecios from './ImportPrecios'

export const dynamic = 'force-dynamic'

const METODOS: { v: MetodoIngesta; l: string }[] = [
  { v: 'import', l: 'Importación Excel' },
  { v: 'manual', l: 'Captura manual' },
  { v: 'scrape', l: 'Portal (scraping)' },
  { v: 'api', l: 'API' },
]

const matchBadge: Record<EstadoMatch, { l: string; c: string }> = {
  pendiente:  { l: 'Sin emparejar', c: 'bg-gray-100 text-gray-500' },
  auto:       { l: 'Auto',          c: 'bg-amber-50 text-amber-700' },
  confirmado: { l: 'Confirmado',    c: 'bg-emerald-50 text-emerald-700' },
  descartado: { l: 'Descartado',    c: 'bg-red-50 text-red-600' },
}

async function guardarProveedor(form: FormData) {
  'use server'
  const id = form.get('id') as string
  await supabase
    .from('proveedores')
    .update({
      nombre: (form.get('nombre') as string) || null,
      metodo_ingesta: form.get('metodo_ingesta') as string,
      portal_url: (form.get('portal_url') as string) || null,
      dias_entrega: form.get('dias_entrega') ? Number(form.get('dias_entrega')) : null,
      activo: form.get('activo') === 'on',
      notas: (form.get('notas') as string) || null,
    })
    .eq('id', id)
  revalidatePath(`/proveedores/${id}`)
  revalidatePath('/proveedores')
}

const fmt = (n: number | null) =>
  n == null ? '—' : n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })

const fmtCad = (iso: string | null) =>
  iso ? new Date(iso + 'T12:00:00').toLocaleDateString('es-MX', { month: 'short', year: 'numeric' }) : '—'

const inputCls = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366]'

export default async function ProveedorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ q?: string }>
}) {
  const { id } = await params
  const { q } = await searchParams

  const { data: prov } = await supabase.from('proveedores').select('*').eq('id', id).single()
  if (!prov) return notFound()
  const p = prov as Proveedor

  let query = supabase
    .from('proveedor_precios')
    .select('id, sku_proveedor, codigo_barras, nombre_prov, laboratorio, presentacion, precio, existencia, en_stock, caducidad, match_estado, fecha_precio')
    .eq('proveedor_id', id)
    .order('nombre_prov')
    .limit(200)

  if (q) query = query.or(`nombre_prov.ilike.%${q}%,sku_proveedor.ilike.%${q}%,laboratorio.ilike.%${q}%`)

  const { data: precios } = await query
  const rows = (precios as ProveedorPrecio[]) ?? []

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <Link href="/proveedores" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 mb-6">
        <ArrowLeftIcon className="w-3.5 h-3.5" /> Proveedores
      </Link>
      <h1 className="text-xl font-semibold text-gray-900 mb-1">{p.nombre}</h1>
      <p className="text-sm text-gray-400 mb-8">/{p.slug}</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Datos del proveedor */}
        <form action={guardarProveedor} className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <input type="hidden" name="id" value={p.id} />
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Datos del proveedor</h2>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Nombre</label>
            <input name="nombre" defaultValue={p.nombre} className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Método de ingesta</label>
              <select name="metodo_ingesta" defaultValue={p.metodo_ingesta} className={inputCls + ' bg-white'}>
                {METODOS.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Días de entrega</label>
              <input type="number" name="dias_entrega" min="0" defaultValue={p.dias_entrega ?? ''} className={inputCls} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">URL del portal</label>
            <input name="portal_url" defaultValue={p.portal_url ?? ''} placeholder="https://..." className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Notas</label>
            <textarea name="notas" rows={2} defaultValue={p.notas ?? ''} className={inputCls + ' resize-none'} />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" name="activo" defaultChecked={p.activo} className="w-4 h-4 rounded border-gray-300 text-[#003366] focus:ring-[#003366]/30" />
            Proveedor activo
          </label>
          {p.credencial_ref && (
            <p className="text-[11px] text-gray-400 border-t border-gray-100 pt-3">
              🔒 Credenciales en secreto: <code className="text-gray-500">{p.credencial_ref}</code> (no se muestran aquí).
            </p>
          )}
          <button type="submit" className="px-5 py-2 bg-[#003366] text-white text-sm font-medium rounded-lg hover:bg-[#002244] transition-colors">
            Guardar
          </button>
        </form>

        {/* Importar precios */}
        <ImportPrecios proveedorId={p.id} />
      </div>

      {/* Catálogo */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Catálogo {rows.length >= 200 && <span className="text-gray-300">(primeros 200)</span>}
          </h2>
          <form method="GET" className="relative w-full sm:w-72">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              name="q"
              defaultValue={q}
              placeholder="Buscar producto, clave o lab..."
              className="w-full pl-9 pr-4 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366]"
            />
          </form>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/40">
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Producto</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Clave</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Costo</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Stock</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Caducidad</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Emparejamiento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.length === 0 && (
                <tr><td colSpan={6} className="text-center py-16 text-gray-300 text-sm">
                  {q ? 'Sin resultados.' : 'Sin precios todavía. Importa una lista arriba.'}
                </td></tr>
              )}
              {rows.map(r => {
                const badge = matchBadge[r.match_estado]
                return (
                  <tr key={r.id} className="hover:bg-gray-50/60 transition-colors">
                    <td className="px-5 py-3 font-medium text-gray-900">
                      {r.nombre_prov}
                      {r.laboratorio && <span className="block text-xs text-gray-400 font-normal">{r.laboratorio}</span>}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-gray-500">{r.sku_proveedor ?? '—'}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-gray-700">{fmt(r.precio)}</td>
                    <td className="px-5 py-3">
                      {r.en_stock == null
                        ? <span className="text-gray-300 text-xs">—</span>
                        : r.en_stock
                          ? <span className="text-emerald-600 text-xs font-medium">{r.existencia ?? ''} pza</span>
                          : <span className="text-red-500 text-xs font-medium">Sin stock</span>}
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs">{fmtCad(r.caducidad)}</td>
                    <td className="px-5 py-3">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${badge.c}`}>{badge.l}</span>
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
