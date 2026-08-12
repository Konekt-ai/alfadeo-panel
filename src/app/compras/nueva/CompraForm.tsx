'use client'

// Captura de una compra (minuta 26) con lectura del CFDI (minuta 29).
//
// El XML es el camino rápido: precarga emisor, factura, totales y una
// partida por concepto, ya intentando amarrar cada renglón a un producto
// del catálogo. Lo que el lector NO puede saber es el lote y la caducidad
// —eso no viene en el CFDI—, así que se capturan aquí: son los que crean
// el lote nuevo en el almacén (minuta 23).

import { useState, useEffect, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  DocumentArrowUpIcon, TrashIcon, PlusIcon, MagnifyingGlassIcon,
  CheckCircleIcon, ExclamationTriangleIcon, LinkIcon,
} from '@heroicons/react/20/solid'
import { pesos } from '@/lib/utils'
import { UBICACIONES } from '@/lib/constantes'
import type { ProductoPOS } from '@/lib/types'
import {
  leerCFDI, crearCompra, buscarProductoCompra,
  type PartidaPrecargada, type PartidaEntrada,
} from '../acciones'

interface Partida extends PartidaEntrada {
  // Sólo para pintar: de dónde salió el amarre con el catálogo.
  match: 'codigo' | 'nombre' | 'ninguno' | 'manual'
  producto_nombre: string | null
}

const vacia = (): Partida => ({
  producto_id: null, descripcion: '', clave_prov: null, codigo_barras: null,
  cantidad: 1, costo_unitario: 0, tasa_iva: 0,
  lote: null, caducidad: null, ubicacion: null,
  match: 'ninguno', producto_nombre: null,
})

const desdePrecargada = (p: PartidaPrecargada): Partida => ({
  producto_id: p.producto_id,
  descripcion: p.descripcion,
  clave_prov: p.clave_prov,
  codigo_barras: p.codigo_barras,
  cantidad: p.cantidad,
  costo_unitario: p.costo_unitario,
  tasa_iva: p.tasa_iva,
  lote: null, caducidad: null, ubicacion: null,
  match: p.match,
  producto_nombre: p.producto_nombre,
})

const hoyISO = () => new Date().toISOString().slice(0, 10)

export default function CompraForm({
  sucursalPorDefecto,
  sucursales,
  proveedores,
}: {
  sucursalPorDefecto: string
  sucursales: { id: string; clave: string; nombre: string }[]
  proveedores: { id: string; nombre: string }[]
}) {
  const router = useRouter()
  const [guardando, startGuardar] = useTransition()
  const [leyendo, setLeyendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const [sucursalId, setSucursalId] = useState(sucursalPorDefecto)
  const [proveedorId, setProveedorId] = useState<string>('')
  const [fecha, setFecha] = useState(hoyISO())
  const [serie, setSerie] = useState('')
  const [folio, setFolio] = useState('')
  const [uuid, setUuid] = useState('')
  const [emisorRfc, setEmisorRfc] = useState('')
  const [emisorNombre, setEmisorNombre] = useState('')
  const [moneda, setMoneda] = useState('MXN')
  const [notas, setNotas] = useState('')
  const [xmlOrigen, setXmlOrigen] = useState<string | null>(null)
  const [partidas, setPartidas] = useState<Partida[]>([vacia()])

  // Buscador de producto de la partida que se está ligando.
  const [ligando, setLigando] = useState<number | null>(null)
  const [q, setQ] = useState('')
  const [resultados, setResultados] = useState<ProductoPOS[]>([])

  useEffect(() => {
    if (ligando === null || q.trim().length < 2) { setResultados([]); return }
    let cancelado = false
    const t = setTimeout(async () => {
      const r = await buscarProductoCompra(q, sucursalId)
      if (!cancelado) setResultados(r.productos)
    }, 250)
    return () => { cancelado = true; clearTimeout(t) }
  }, [q, ligando, sucursalId])

  const totales = useMemo(() => {
    let subtotal = 0, iva = 0
    for (const p of partidas) {
      const base = Math.round(p.cantidad * p.costo_unitario * 100) / 100
      subtotal += base
      iva += Math.round(base * p.tasa_iva * 100) / 100
    }
    return { subtotal, iva, total: subtotal + iva }
  }, [partidas])

  const sinLigar = partidas.filter(p => !p.producto_id).length

  // --- Lector de facturas ---------------------------------------------

  const subirXML = async (file: File) => {
    setError(null); setAviso(null); setLeyendo(true)
    try {
      const texto = await file.text()
      const r = await leerCFDI(texto, sucursalId)
      if (!r.ok) { setError(r.error); return }

      setSerie(r.cfdi.serie ?? '')
      setFolio(r.cfdi.folio ?? '')
      setUuid(r.cfdi.uuid ?? '')
      setEmisorRfc(r.cfdi.emisor_rfc ?? '')
      setEmisorNombre(r.cfdi.emisor_nombre ?? '')
      setMoneda(r.cfdi.moneda ?? 'MXN')
      if (r.cfdi.fecha) setFecha(r.cfdi.fecha)
      setXmlOrigen(texto)
      setPartidas(r.partidas.length ? r.partidas.map(desdePrecargada) : [vacia()])

      const ligadas = r.partidas.filter(p => p.producto_id).length
      setAviso(
        `Factura leída: ${r.partidas.length} partidas, ${ligadas} ligadas al catálogo. ` +
        'Falta capturar lote y caducidad de cada una.'
      )
    } catch {
      setError('No se pudo leer el archivo. Asegúrate de que sea el XML del CFDI.')
    } finally {
      setLeyendo(false)
    }
  }

  // --- Partidas --------------------------------------------------------

  const cambiar = (i: number, campo: keyof Partida, valor: string | number | null) => {
    setPartidas(prev => prev.map((p, j) => j === i ? { ...p, [campo]: valor } : p))
  }

  const ligar = (i: number, prod: ProductoPOS) => {
    setPartidas(prev => prev.map((p, j) => j === i ? {
      ...p,
      producto_id: prod.producto_id,
      producto_nombre: prod.nombre_comercial ?? prod.nombre,
      // La tasa buena es la del catálogo, no la del proveedor: es la que se
      // va a usar al vender (minuta 3).
      tasa_iva: Number(prod.tasa_iva ?? 0),
      descripcion: p.descripcion || prod.nombre,
      match: 'manual',
    } : p))
    setLigando(null); setQ(''); setResultados([])
  }

  const guardar = (recibir: boolean) => {
    setError(null)
    if (!partidas.length) { setError('Agrega al menos una partida.'); return }
    if (partidas.some(p => !p.descripcion.trim())) { setError('Hay una partida sin descripción.'); return }
    if (partidas.some(p => !(p.cantidad > 0))) { setError('Hay una partida con cantidad en cero.'); return }
    if (recibir && sinLigar > 0) {
      setError(`Faltan ${sinLigar} partidas por ligar a un producto del catálogo. Sin eso no se puede dar entrada.`)
      return
    }

    startGuardar(async () => {
      const r = await crearCompra({
        proveedor_id: proveedorId || null,
        sucursal_id: sucursalId,
        fecha,
        factura_serie: serie.trim() || null,
        factura_folio: folio.trim() || null,
        factura_uuid: uuid.trim() || null,
        emisor_rfc: emisorRfc.trim() || null,
        emisor_nombre: emisorNombre.trim() || null,
        moneda,
        notas: notas.trim() || null,
        xml_origen: xmlOrigen,
        recibir,
        partidas: partidas.map(p => ({
          producto_id: p.producto_id,
          descripcion: p.descripcion,
          clave_prov: p.clave_prov,
          codigo_barras: p.codigo_barras,
          cantidad: p.cantidad,
          costo_unitario: p.costo_unitario,
          tasa_iva: p.tasa_iva,
          lote: p.lote?.trim() || null,
          caducidad: p.caducidad || null,
          ubicacion: p.ubicacion || null,
        })),
      })
      if (!r.ok) { setError(r.error); return }
      router.push(`/compras/${r.data.id}`)
    })
  }

  const input = 'w-full px-4 py-3 text-base border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366]'
  const inputSm = 'w-full px-3 py-2 text-base border border-gray-200 rounded-lg focus:outline-none focus:border-[#003366]'
  const label = 'block text-sm font-semibold text-gray-500 uppercase tracking-wide mb-1.5'
  const tarjeta = 'bg-white border border-gray-200 rounded-xl'

  const ETIQUETA_MATCH = {
    codigo:  { texto: 'Ligado por código de barras', color: 'text-emerald-700' },
    manual:  { texto: 'Ligado a mano',               color: 'text-emerald-700' },
    nombre:  { texto: 'Sugerido por nombre — revísalo', color: 'text-amber-700' },
    ninguno: { texto: 'Sin ligar',                   color: 'text-red-600' },
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-base flex items-start gap-2">
          <ExclamationTriangleIcon className="w-5 h-5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      {aviso && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-4 text-base flex items-start gap-2">
          <CheckCircleIcon className="w-5 h-5 shrink-0 mt-0.5" />
          <span>{aviso}</span>
        </div>
      )}

      {/* Lector de facturas */}
      <div className={`${tarjeta} p-5`}>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Leer la factura del proveedor</h2>
        <p className="text-base text-gray-500 mb-4">
          Sube el <strong>XML</strong> del CFDI y se llena todo. El PDF no sirve: el XML es
          el que trae los datos exactos.
        </p>
        <label className="inline-flex items-center gap-2 px-5 py-3 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-[#003366]/40 transition-colors text-base font-medium text-gray-700">
          <DocumentArrowUpIcon className="w-5 h-5 text-gray-400" />
          {leyendo ? 'Leyendo…' : 'Elegir archivo XML'}
          <input
            type="file" accept=".xml,text/xml,application/xml" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) subirXML(f); e.target.value = '' }}
          />
        </label>
      </div>

      {/* Datos de la compra */}
      <div className={`${tarjeta} p-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-4`}>
        <div>
          <label className={label}>Plaza que recibe</label>
          <select value={sucursalId} onChange={e => setSucursalId(e.target.value)} className={input}>
            {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Proveedor</label>
          <select value={proveedorId} onChange={e => setProveedorId(e.target.value)} className={input}>
            <option value="">Sin registrar</option>
            {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Fecha</label>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} className={input} />
        </div>
        <div>
          <label className={label}>Emisor</label>
          <input value={emisorNombre} onChange={e => setEmisorNombre(e.target.value)} className={input} placeholder="Nombre del proveedor en la factura" />
        </div>
        <div>
          <label className={label}>RFC del emisor</label>
          <input value={emisorRfc} onChange={e => setEmisorRfc(e.target.value)} className={input} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Serie</label>
            <input value={serie} onChange={e => setSerie(e.target.value)} className={input} />
          </div>
          <div>
            <label className={label}>Folio</label>
            <input value={folio} onChange={e => setFolio(e.target.value)} className={input} />
          </div>
        </div>
        <div className="sm:col-span-2">
          <label className={label}>Folio fiscal (UUID)</label>
          <input value={uuid} onChange={e => setUuid(e.target.value)} className={`${input} font-mono text-sm`} />
        </div>
        <div>
          <label className={label}>Notas</label>
          <input value={notas} onChange={e => setNotas(e.target.value)} className={input} />
        </div>
      </div>

      {/* Partidas */}
      <div className={tarjeta}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Partidas</h2>
            {sinLigar > 0 && (
              <p className="text-sm text-amber-700 mt-0.5">
                {sinLigar} sin ligar al catálogo. La mercancía no puede entrar hasta que lo estén.
              </p>
            )}
          </div>
          <button
            onClick={() => setPartidas(prev => [...prev, vacia()])}
            className="inline-flex items-center gap-1.5 px-4 py-2 border border-gray-300 text-gray-700 text-base font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            <PlusIcon className="w-4 h-4" />
            Agregar
          </button>
        </div>

        <div className="divide-y divide-gray-100">
          {partidas.map((p, i) => {
            const etiqueta = ETIQUETA_MATCH[p.match]
            return (
              <div key={i} className="p-5 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <input
                      value={p.descripcion}
                      onChange={e => cambiar(i, 'descripcion', e.target.value)}
                      placeholder="Descripción de la factura"
                      className={`${inputSm} font-medium`}
                    />
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className={`text-sm font-medium ${etiqueta.color}`}>{etiqueta.texto}</span>
                      {p.producto_nombre && (
                        <span className="text-sm text-gray-500">→ {p.producto_nombre}</span>
                      )}
                      <button
                        onClick={() => { setLigando(ligando === i ? null : i); setQ(p.descripcion) }}
                        className="inline-flex items-center gap-1 text-sm font-medium text-[#003366] hover:underline"
                      >
                        <LinkIcon className="w-3.5 h-3.5" />
                        {p.producto_id ? 'Cambiar' : 'Ligar al catálogo'}
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={() => setPartidas(prev => prev.filter((_, j) => j !== i))}
                    className="text-gray-300 hover:text-red-600 transition-colors p-1"
                    aria-label="Quitar partida"
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>

                {ligando === i && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                    <div className="relative">
                      <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        value={q} onChange={e => setQ(e.target.value)} autoFocus
                        placeholder="Buscar en el catálogo por nombre o código"
                        className={`${inputSm} pl-9 bg-white`}
                      />
                    </div>
                    <div className="mt-2 space-y-1 max-h-56 overflow-y-auto">
                      {resultados.map(prod => (
                        <button
                          key={prod.producto_id}
                          onClick={() => ligar(i, prod)}
                          className="w-full text-left px-3 py-2.5 bg-white border border-gray-200 rounded-lg hover:border-[#003366]/40 transition-colors"
                        >
                          <div className="font-medium text-base text-gray-900">
                            {prod.nombre_comercial ?? prod.nombre}
                          </div>
                          <div className="text-sm text-gray-500">
                            {[prod.nombre_generico, prod.concentracion, prod.presentacion].filter(Boolean).join(' · ')}
                            {prod.codigo_barras && ` · ${prod.codigo_barras}`}
                          </div>
                        </button>
                      ))}
                      {q.trim().length >= 2 && resultados.length === 0 && (
                        <p className="text-sm text-gray-400 py-2 px-1">
                          Sin resultados. Si el producto es nuevo, dalo de alta en Inventario primero.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  <div>
                    <label className="block text-sm text-gray-500 mb-1">Cantidad</label>
                    <input type="number" min="0" step="0.001" value={p.cantidad}
                      onChange={e => cambiar(i, 'cantidad', Number(e.target.value) || 0)} className={inputSm} />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-500 mb-1">Costo unit.</label>
                    <input type="number" min="0" step="0.01" value={p.costo_unitario}
                      onChange={e => cambiar(i, 'costo_unitario', Number(e.target.value) || 0)} className={inputSm} />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-500 mb-1">IVA</label>
                    <select value={p.tasa_iva} onChange={e => cambiar(i, 'tasa_iva', Number(e.target.value))} className={inputSm}>
                      <option value={0}>0%</option>
                      <option value={0.08}>8%</option>
                      <option value={0.16}>16%</option>
                    </select>
                  </div>
                  {/* Lote y caducidad no vienen en el CFDI: se leen de la caja
                      física. Son los que crean el lote (minuta 23). */}
                  <div>
                    <label className="block text-sm text-gray-500 mb-1">Lote</label>
                    <input value={p.lote ?? ''} onChange={e => cambiar(i, 'lote', e.target.value)}
                      className={inputSm} placeholder="De la caja" />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-500 mb-1">Caducidad</label>
                    <input type="date" value={p.caducidad ?? ''}
                      onChange={e => cambiar(i, 'caducidad', e.target.value)} className={inputSm} />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-500 mb-1">Ubicación</label>
                    <select value={p.ubicacion ?? ''} onChange={e => cambiar(i, 'ubicacion', e.target.value)} className={inputSm}>
                      <option value="">—</option>
                      {UBICACIONES.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                </div>

                <div className="text-right text-base font-medium text-gray-900">
                  {pesos(Math.round(p.cantidad * p.costo_unitario * 100) / 100)}
                </div>
              </div>
            )
          })}
        </div>

        <div className="px-5 py-4 bg-gray-50 border-t border-gray-200">
          <div className="ml-auto max-w-xs space-y-1">
            <div className="flex justify-between text-base text-gray-600">
              <span>Subtotal</span><span>{pesos(totales.subtotal)}</span>
            </div>
            <div className="flex justify-between text-base text-gray-600">
              <span>IVA</span><span>{pesos(totales.iva)}</span>
            </div>
            <div className="flex justify-between text-xl font-semibold text-gray-900 pt-1">
              <span>Total</span><span>{pesos(totales.total)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={() => guardar(true)}
          disabled={guardando}
          className="flex-1 px-5 py-3.5 bg-[#003366] text-white text-base font-semibold rounded-lg hover:bg-[#002244] disabled:opacity-50 transition-colors"
        >
          {guardando ? 'Guardando…' : 'Guardar y recibir la mercancía'}
        </button>
        <button
          onClick={() => guardar(false)}
          disabled={guardando}
          className="flex-1 px-5 py-3.5 border border-gray-300 text-gray-700 text-base font-medium rounded-lg hover:bg-white disabled:opacity-50 transition-colors"
        >
          Guardar como borrador
        </button>
      </div>
      <p className="text-sm text-gray-500 -mt-3">
        Recibir la mercancía es lo que la mete al inventario y crea los lotes. En borrador
        no se toca ninguna existencia.
      </p>
    </div>
  )
}
