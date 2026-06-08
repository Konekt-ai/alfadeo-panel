'use client'

import { useState, useCallback, useTransition } from 'react'
import { PlusIcon, TrashIcon, MagnifyingGlassIcon, CheckBadgeIcon } from '@heroicons/react/20/solid'
import type { Producto, SolicitudItem, OpcionCompra, Margen, TipoCliente, OrigenCompra } from '@/lib/types'
import { sugerir, precioConMargen } from '@/lib/cotizador'

interface LineaItem {
  key: number
  producto_id: string
  descripcion: string
  cantidad: number
  unidad: string
  precio_unitario: number
  iva_exento: boolean
  sujeto_confirmacion: boolean
  // Cotizador inteligente:
  opciones: OpcionCompra[]
  proveedor_id: string
  origen_compra: OrigenCompra | ''
  costo: number
  margen_pct: number
}

interface Props {
  solicitudId: string
  clienteId: string
  tipoCliente: TipoCliente | null
  items: SolicitudItem[]
  productos: Producto[]
  opcionesPorProducto: Record<string, OpcionCompra[]>
  margenes: Margen[]
  action: (form: FormData) => Promise<void>
}

let nextKey = 1

const baseLinea = {
  opciones: [] as OpcionCompra[],
  proveedor_id: '',
  origen_compra: '' as OrigenCompra | '',
  costo: 0,
  margen_pct: 0,
}

function lineaDesdeItem(item: SolicitudItem): LineaItem {
  return {
    key: nextKey++,
    producto_id: '',
    descripcion: item.descripcion_libre ?? '',
    cantidad: item.cantidad ?? 1,
    unidad: item.unidad ?? 'pza',
    precio_unitario: 0,
    iva_exento: false,
    sujeto_confirmacion: true,
    ...baseLinea,
  }
}

function lineaVacia(): LineaItem {
  return {
    key: nextKey++,
    producto_id: '',
    descripcion: '',
    cantidad: 1,
    unidad: 'pza',
    precio_unitario: 0,
    iva_exento: false,
    sujeto_confirmacion: true,
    ...baseLinea,
  }
}

const fmt = (n: number) =>
  n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`

const fmtCad = (iso: string | null) =>
  iso ? new Date(iso + 'T12:00:00').toLocaleDateString('es-MX', { month: 'short', year: '2-digit' }) : null

const mismaOpcion = (l: LineaItem, o: OpcionCompra) =>
  l.origen_compra === o.origen && (l.proveedor_id || null) === (o.proveedor_id || null)

const inputCls =
  'w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366]'

export default function CotizadorForm({ solicitudId, clienteId, tipoCliente, items, productos, opcionesPorProducto, margenes, action }: Props) {
  const [lineas, setLineas] = useState<LineaItem[]>(
    items.length ? items.map(lineaDesdeItem) : [lineaVacia()]
  )
  const [vigencia, setVigencia] = useState(15)
  const [condiciones, setCondiciones] = useState('Precios sujetos a disponibilidad de inventario.')
  const [notas, setNotas] = useState('')
  const [search, setSearch] = useState<Record<number, string>>({})
  const [isPending, startTransition] = useTransition()

  const updateLinea = useCallback((key: number, patch: Partial<LineaItem>) => {
    setLineas(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l))
  }, [])

  const aplicarProducto = (key: number, prod: Producto) => {
    const ops = opcionesPorProducto[prod.id] ?? []
    const sug = sugerir(ops, margenes, {
      tipo: tipoCliente,
      categoria: prod.categoria,
      producto_id: prod.id,
    })
    updateLinea(key, {
      producto_id: prod.id,
      descripcion: prod.nombre,
      unidad: prod.unidad ?? 'pza',
      iva_exento: prod.iva_exento,
      opciones: sug.opciones,
      margen_pct: sug.margen_pct,
      costo: sug.costo,
      proveedor_id: sug.elegida?.proveedor_id ?? '',
      origen_compra: sug.elegida?.origen ?? '',
      // Si hay opciones, precio sugerido; si no, cae al precio base del catálogo.
      precio_unitario: sug.elegida ? sug.precio_sugerido : (prod.precio_base ?? 0),
    })
    setSearch(prev => ({ ...prev, [key]: '' }))
  }

  // El operador elige manualmente otra fuente de compra para esta línea.
  const elegirOpcion = (linea: LineaItem, o: OpcionCompra) => {
    const costo = o.costo ?? 0
    updateLinea(linea.key, {
      proveedor_id: o.proveedor_id ?? '',
      origen_compra: o.origen,
      costo,
      precio_unitario: precioConMargen(costo, linea.margen_pct),
    })
  }

  const subtotalLinea = (l: LineaItem) => l.cantidad * l.precio_unitario

  const subtotal = lineas.reduce((s, l) => s + subtotalLinea(l), 0)
  const iva = lineas.reduce((s, l) => s + (l.iva_exento ? 0 : subtotalLinea(l) * 0.16), 0)
  const total = subtotal + iva

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData()
    fd.set('solicitud_id', solicitudId)
    fd.set('cliente_id', clienteId)
    fd.set('vigencia_dias', String(vigencia))
    fd.set('condiciones', condiciones)
    fd.set('notas', notas)
    fd.set('items', JSON.stringify(lineas.map(l => ({
      descripcion: l.descripcion,
      producto_id: l.producto_id,
      cantidad: l.cantidad,
      unidad: l.unidad,
      precio_unitario: l.precio_unitario,
      iva_exento: l.iva_exento,
      sujeto_confirmacion: l.sujeto_confirmacion,
      proveedor_id: l.proveedor_id || null,
      origen_compra: l.origen_compra || null,
      costo_unitario: l.costo || null,
      // Margen efectivo según el precio final (puede haberse ajustado a mano).
      margen_pct: l.costo > 0
        ? Math.round((l.precio_unitario / l.costo - 1) * 1000) / 1000
        : null,
    }))))
    startTransition(() => action(fd))
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Tabla de líneas */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Líneas de cotización</h2>
          <button
            type="button"
            onClick={() => setLineas(prev => [...prev, lineaVacia()])}
            className="inline-flex items-center gap-1 text-xs font-medium text-[#003366] hover:text-[#002244]"
          >
            <PlusIcon className="w-3.5 h-3.5" /> Agregar línea
          </button>
        </div>

        <div className="overflow-x-auto overscroll-x-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
          <table className="w-full text-sm" style={{ minWidth: '720px' }}>
            <thead>
              <tr className="bg-gray-50/60 border-b border-gray-100 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                <th className="text-left px-4 py-3 w-8">#</th>
                <th className="text-left px-4 py-3 min-w-[260px]">Descripción / Producto</th>
                <th className="text-left px-4 py-3 w-24">Cantidad</th>
                <th className="text-left px-4 py-3 w-20">Unidad</th>
                <th className="text-left px-4 py-3 w-32">Precio unit.</th>
                <th className="text-center px-4 py-3 w-16">IVA</th>
                <th className="text-center px-4 py-3 w-16">Suj. conf.</th>
                <th className="text-right px-4 py-3 w-28">Subtotal</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {lineas.map((linea, i) => {
                const q = (search[linea.key] ?? '').toLowerCase()
                const sugerencias = q.length > 1
                  ? productos.filter(p =>
                      p.nombre.toLowerCase().includes(q) ||
                      (p.laboratorio ?? '').toLowerCase().includes(q)
                    ).slice(0, 6)
                  : []

                return (
                  <tr key={linea.key} className="align-top">
                    <td className="px-4 py-3 text-gray-300 font-mono text-xs pt-4">
                      {String(i + 1).padStart(2, '0')}
                    </td>

                    {/* Descripción + búsqueda */}
                    <td className="px-4 py-3">
                      <input
                        className={inputCls}
                        placeholder="Descripción del producto"
                        value={linea.descripcion}
                        onChange={e => updateLinea(linea.key, { descripcion: e.target.value })}
                        required
                      />
                      {/* Buscador de catálogo */}
                      <div className="relative mt-1.5">
                        <div className="relative">
                          <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-300" />
                          <input
                            className="w-full pl-7 pr-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366] placeholder:text-gray-300"
                            placeholder="Buscar en catálogo..."
                            value={search[linea.key] ?? ''}
                            onChange={e => setSearch(prev => ({ ...prev, [linea.key]: e.target.value }))}
                          />
                        </div>
                        {sugerencias.length > 0 && (
                          <ul className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                            {sugerencias.map(p => (
                              <li key={p.id}>
                                <button
                                  type="button"
                                  onClick={() => aplicarProducto(linea.key, p)}
                                  className="w-full text-left px-3 py-2 text-xs hover:bg-[#003366]/5 transition-colors"
                                >
                                  <div className="font-medium text-gray-800 truncate">{p.nombre}</div>
                                  <div className="text-gray-400">
                                    {p.laboratorio ?? '—'}
                                    {p.precio_base != null && (
                                      <span className="ml-2 text-[#003366] font-medium">
                                        {fmt(p.precio_base)}
                                      </span>
                                    )}
                                  </div>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      {linea.producto_id && linea.opciones.length === 0 && (
                        <div className="mt-1 text-[10px] text-amber-600">
                          Vinculado al catálogo · sin opciones de compra (precio manual)
                        </div>
                      )}

                      {/* Cotizador inteligente: comparación de fuentes de compra */}
                      {linea.opciones.length > 0 && (
                        <div className="mt-2 border border-gray-100 rounded-lg p-2 bg-gray-50/50">
                          <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5 px-1">
                            Opciones de compra
                          </div>
                          <div className="space-y-1">
                            {linea.opciones.map((o, idx) => {
                              const sel = mismaOpcion(linea, o)
                              const sinStock = o.en_stock === false
                              return (
                                <button
                                  key={`${o.origen}-${o.proveedor_id ?? 'inv'}`}
                                  type="button"
                                  onClick={() => elegirOpcion(linea, o)}
                                  className={`w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-md text-xs transition-colors ${
                                    sel ? 'bg-[#003366]/10 ring-1 ring-[#003366]/30' : 'hover:bg-white'
                                  }`}
                                >
                                  <span className={`shrink-0 w-3.5 ${sel ? 'text-[#003366]' : 'text-transparent'}`}>
                                    {sel && <CheckBadgeIcon className="w-3.5 h-3.5" />}
                                  </span>
                                  <span className="flex-1 min-w-0">
                                    <span className="font-medium text-gray-700 truncate block">
                                      {o.fuente_nombre}
                                      {idx === 0 && (
                                        <span className="ml-1.5 text-[9px] font-semibold text-emerald-600 uppercase">Recomendado</span>
                                      )}
                                    </span>
                                    <span className="text-gray-400">
                                      {o.existencia != null && <>{o.existencia} pza · </>}
                                      {fmtCad(o.caducidad) && <>cad. {fmtCad(o.caducidad)} · </>}
                                      {sinStock
                                        ? <span className="text-red-500 font-medium">sin stock</span>
                                        : <span className="text-emerald-600 font-medium">disponible</span>}
                                    </span>
                                  </span>
                                  <span className="shrink-0 font-semibold text-gray-700 tabular-nums">
                                    {o.costo != null ? fmt(o.costo) : '—'}
                                  </span>
                                </button>
                              )
                            })}
                          </div>
                          <div className="flex items-center justify-between px-2 pt-1.5 mt-1 border-t border-gray-100 text-[10px] text-gray-500">
                            <span>Costo {fmt(linea.costo)} · margen {fmtPct(linea.margen_pct)}</span>
                            <span className="font-semibold text-[#003366]">
                              Venta {fmt(precioConMargen(linea.costo, linea.margen_pct))}
                            </span>
                          </div>
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min="0.001"
                        step="any"
                        className={inputCls}
                        value={linea.cantidad}
                        onChange={e => updateLinea(linea.key, { cantidad: Number(e.target.value) })}
                        required
                      />
                    </td>

                    <td className="px-4 py-3">
                      <input
                        className={inputCls}
                        value={linea.unidad}
                        onChange={e => updateLinea(linea.key, { unidad: e.target.value })}
                        placeholder="pza"
                      />
                    </td>

                    <td className="px-4 py-3">
                      <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className="w-full pl-6 pr-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366]"
                          value={linea.precio_unitario}
                          onChange={e => updateLinea(linea.key, { precio_unitario: Number(e.target.value) })}
                          required
                        />
                      </div>
                    </td>

                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={linea.iva_exento}
                        onChange={e => updateLinea(linea.key, { iva_exento: e.target.checked })}
                        className="w-4 h-4 rounded border-gray-300 text-[#003366] focus:ring-[#003366]/30"
                      />
                    </td>

                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={linea.sujeto_confirmacion}
                        onChange={e => updateLinea(linea.key, { sujeto_confirmacion: e.target.checked })}
                        className="w-4 h-4 rounded border-gray-300 text-[#003366] focus:ring-[#003366]/30"
                      />
                    </td>

                    <td className="px-4 py-3 text-right font-medium text-gray-700 tabular-nums pt-4">
                      {fmt(subtotalLinea(linea))}
                    </td>

                    <td className="px-2 py-3 pt-4">
                      {lineas.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setLineas(prev => prev.filter(l => l.key !== linea.key))}
                          className="text-gray-300 hover:text-red-400 transition-colors"
                        >
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Totales */}
        <div className="border-t border-gray-100 px-6 py-4 flex justify-end">
          <div className="w-64 space-y-2 text-sm">
            <div className="flex justify-between text-gray-500">
              <span>Subtotal</span>
              <span className="tabular-nums">{fmt(subtotal)}</span>
            </div>
            <div className="flex justify-between text-gray-500">
              <span>IVA (16%)</span>
              <span className="tabular-nums">{fmt(iva)}</span>
            </div>
            <div className="flex justify-between font-semibold text-gray-900 border-t border-gray-200 pt-2">
              <span>Total</span>
              <span className="tabular-nums text-[#003366]">{fmt(total)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Condiciones */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 md:p-6 grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Vigencia (días)</label>
          <input
            type="number"
            min="1"
            className={inputCls}
            value={vigencia}
            onChange={e => setVigencia(Number(e.target.value))}
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Condiciones comerciales</label>
          <textarea
            rows={3}
            className={inputCls + ' resize-none'}
            value={condiciones}
            onChange={e => setCondiciones(e.target.value)}
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Notas internas</label>
          <textarea
            rows={2}
            className={inputCls + ' resize-none'}
            value={notas}
            onChange={e => setNotas(e.target.value)}
            placeholder="Solo visibles para el equipo ALFA-DEO"
          />
        </div>
      </div>

      {/* Acciones */}
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isPending || lineas.every(l => !l.descripcion)}
          className="px-6 py-2.5 bg-[#003366] text-white text-sm font-medium rounded-lg hover:bg-[#002244] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? 'Guardando...' : 'Guardar cotización'}
        </button>
        <a href={`/solicitudes/${solicitudId}`} className="px-6 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors">
          Cancelar
        </a>
      </div>
    </form>
  )
}
