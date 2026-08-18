import Link from 'next/link'
import { sql, faltaMigracion } from '@/lib/db'
import { pesos, formatDia } from '@/lib/utils'
import { SUCURSALES } from '@/lib/constantes'
import { PlusIcon } from '@heroicons/react/20/solid'
import type { EstadoCompra } from '@/lib/types'

export const dynamic = 'force-dynamic'

// Captura de compras al recibir mercancía (minuta 26). Mientras está en
// borrador no toca el inventario: sólo al recibirla entran los lotes.
const ESTADOS: { valor: EstadoCompra; label: string; color: string }[] = [
  { valor: 'borrador',  label: 'Por recibir', color: 'bg-amber-100 text-amber-800' },
  { valor: 'recibida',  label: 'Recibida',    color: 'bg-emerald-100 text-emerald-800' },
  { valor: 'cancelada', label: 'Cancelada',   color: 'bg-gray-100 text-gray-500' },
]

const estiloEstado = (e: string) =>
  ESTADOS.find(x => x.valor === e) ?? { label: e, color: 'bg-gray-100 text-gray-700' }

interface FilaCompra {
  id: string
  folio: string | null
  fecha: string
  estado: EstadoCompra
  total: number
  moneda: string
  factura_serie: string | null
  factura_folio: string | null
  emisor_nombre: string | null
  usuario: string | null
  proveedores: { nombre: string } | null
  sucursales: { clave: string } | null
  num_partidas: number
}

export default async function ComprasPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; sucursal?: string }>
}) {
  const params = await searchParams

  // Los tres embebidos de antes: proveedor y plaza como objeto (para que el
  // JSX siga usando c.proveedores?.nombre), y las partidas sólo contadas,
  // que es lo único que se usaba de ellas.
  const { data: todas, error } = await sql<FilaCompra>(
    `select c.id, c.folio, c.fecha, c.estado, c.total, c.moneda,
            c.factura_serie, c.factura_folio, c.emisor_nombre, c.usuario,
            case when p.id is null then null
                 else json_build_object('nombre', p.nombre) end as proveedores,
            case when s.id is null then null
                 else json_build_object('clave', s.clave) end as sucursales,
            (select count(*) from compra_items ci where ci.compra_id = c.id)::int
              as num_partidas
       from compras c
       left join proveedores p on p.id = c.proveedor_id
       left join sucursales  s on s.id = c.sucursal_id
      order by c.fecha desc, c.folio desc
      limit 300`
  )
  const rows = todas.filter(c => {
    if (params.estado && c.estado !== params.estado) return false
    if (params.sucursal && c.sucursales?.clave !== params.sucursal) return false
    return true
  })

  const buildUrl = (o: Record<string, string | undefined>) => {
    const p = { estado: params.estado, sucursal: params.sucursal, ...o }
    const qs = Object.entries(p).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&')
    return `/compras${qs ? `?${qs}` : ''}`
  }

  const chip = (activo: boolean) =>
    `px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors ${
      activo ? 'text-white' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
    }`

  const porRecibir = rows.filter(c => c.estado === 'borrador').length

  return (
    <div className="p-8">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Compras</h1>
          <p className="text-base text-gray-500 mt-1">
            {rows.length} compras
            {porRecibir > 0 && ` · ${porRecibir} por recibir`}
          </p>
        </div>
        <Link href="/compras/nueva"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#003366] text-white text-base font-medium rounded-lg hover:bg-[#002244] transition-colors">
          <PlusIcon className="w-5 h-5" />
          Nueva compra
        </Link>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6 space-y-4">
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-sm text-gray-500 mr-1 font-medium">Estado:</span>
          {ESTADOS.map(e => (
            <a key={e.valor} href={buildUrl({ estado: params.estado === e.valor ? undefined : e.valor })}
              className={chip(params.estado === e.valor)}
              style={params.estado === e.valor ? { background: '#003366', borderColor: '#003366' } : undefined}>
              {e.label}
            </a>
          ))}
        </div>
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

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-base min-w-[900px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Folio</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Fecha</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Proveedor</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Factura</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Plaza</th>
                <th className="text-right px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Partidas</th>
                <th className="text-right px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Total</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.length === 0 && (
                <tr><td colSpan={8} className="text-center py-20 text-gray-400 text-base">
                  Sin compras capturadas.
                </td></tr>
              )}
              {rows.map(c => {
                const est = estiloEstado(c.estado)
                return (
                  <tr key={c.id} className="hover:bg-gray-50/60 transition-colors">
                    <td className="px-5 py-4">
                      <Link href={`/compras/${c.id}`} className="font-semibold text-[#003366] hover:underline">
                        {c.folio ?? '—'}
                      </Link>
                    </td>
                    <td className="px-5 py-4 text-gray-600 whitespace-nowrap">{formatDia(c.fecha)}</td>
                    <td className="px-5 py-4 text-gray-900">
                      {c.proveedores?.nombre ?? c.emisor_nombre ?? <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-5 py-4 text-gray-500 whitespace-nowrap">
                      {[c.factura_serie, c.factura_folio].filter(Boolean).join('-') || '—'}
                    </td>
                    <td className="px-5 py-4">
                      {c.sucursales?.clave ? (
                        <span className={`text-sm font-semibold px-2.5 py-1 rounded-md ${
                          c.sucursales.clave === 'GDL' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'
                        }`}>{c.sucursales.clave}</span>
                      ) : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-5 py-4 text-right text-gray-600">{c.num_partidas}</td>
                    <td className="px-5 py-4 text-right font-medium text-gray-900 whitespace-nowrap">
                      {pesos(c.total)}
                    </td>
                    <td className="px-5 py-4">
                      <span className={`text-sm font-medium px-2.5 py-1 rounded-md whitespace-nowrap ${est.color}`}>
                        {est.label}
                      </span>
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
