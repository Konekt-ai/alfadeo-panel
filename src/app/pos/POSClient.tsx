'use client'

// La caja (minuta 11, 16, 22, 23, 3).
//
// Tres decisiones que explican cómo está armado:
//
//  1. Un solo campo de búsqueda para la pistola y para el teclado. El RPC
//     acepta nombre o código de barras y le da score 2.00 al código exacto,
//     así que se distingue el escaneo sin cambiar de modo (minuta 22).
//  2. El IVA no se calcula con una constante: cada partida trae la tasa de
//     su producto. La mayoría de lo que venden va en 0% (minuta 3).
//  3. El total y el botón de cobrar viven en una barra fija abajo en el
//     celular. Lo usan desde el teléfono, no sólo desde la computadora.

import { useState, useEffect, useRef, useTransition, useMemo, useCallback } from 'react'
import Link from 'next/link'
import {
  MagnifyingGlassIcon, PlusIcon, MinusIcon, XMarkIcon, TrashIcon,
} from '@heroicons/react/20/solid'
import {
  ShoppingCartIcon, CheckCircleIcon, ExclamationTriangleIcon, UserIcon,
} from '@heroicons/react/24/outline'
import { pesos, formatDia, nombreProducto } from '@/lib/utils'
import { FORMAS_PAGO, DIAS_CREDITO } from '@/lib/constantes'
import type { ProductoPOS, FormaPago, UsuarioPanel } from '@/lib/types'
import {
  buscarProductosPOS, buscarClientesPOS, cerrarVentaPOS, fijarCajero, fijarPlaza,
} from './acciones'

// Los tipos de las acciones no se exportan; se derivan de su firma para que
// no se puedan desincronizar.
type ClientePOS = Awaited<ReturnType<typeof buscarClientesPOS>>['clientes'][number]
type Ticket = Extract<Awaited<ReturnType<typeof cerrarVentaPOS>>, { ok: true }>

interface Linea {
  producto_id: string
  descripcion: string
  cantidad: number
  precio_unitario: number
  descuento_pct: number
  tasa_iva: number
  existencia: number
  controlado: boolean
}

const redondear = (n: number) => Math.round(n * 100) / 100

// Una cadena de puros dígitos y larga viene de la pistola, no del teclado.
const pareceCodigoBarras = (s: string) => /^\d{8,}$/.test(s.trim())

export default function POSClient({
  sucursal,
  sucursales,
  usuarios,
  usuario,
}: {
  sucursal: { id: string; clave: string; nombre: string }
  sucursales: { id: string; clave: string; nombre: string }[]
  usuarios: UsuarioPanel[]
  usuario: string | null
}) {
  const [q, setQ] = useState('')
  const [resultados, setResultados] = useState<ProductoPOS[]>([])
  const [buscando, setBuscando] = useState(false)
  const [carrito, setCarrito] = useState<Linea[]>([])
  const [error, setError] = useState<string | null>(null)
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [cobrando, startCobro] = useTransition()
  const [panelCobro, setPanelCobro] = useState(false)

  // Datos del cobro
  const [cliente, setCliente] = useState<ClientePOS | null>(null)
  const [qCliente, setQCliente] = useState('')
  const [clientes, setClientes] = useState<ClientePOS[]>([])
  const [formaPago, setFormaPago] = useState<FormaPago>('efectivo')
  const [diasCredito, setDiasCredito] = useState(10)
  const [requiereFactura, setRequiereFactura] = useState(false)
  const [notas, setNotas] = useState('')

  const inputRef = useRef<HTMLInputElement>(null)
  // El texto que disparó la última búsqueda, para reconocer el escaneo
  // cuando llega la respuesta.
  const consultaRef = useRef('')

  const enfocar = useCallback(() => inputRef.current?.focus(), [])

  useEffect(() => { enfocar() }, [enfocar])

  // --- Carrito ---------------------------------------------------------

  const agregar = useCallback((p: ProductoPOS) => {
    setError(null)
    setCarrito(prev => {
      const i = prev.findIndex(l => l.producto_id === p.producto_id)
      if (i >= 0) {
        const copia = [...prev]
        copia[i] = { ...copia[i], cantidad: copia[i].cantidad + 1 }
        return copia
      }
      return [...prev, {
        producto_id: p.producto_id,
        descripcion: p.nombre,
        cantidad: 1,
        precio_unitario: Number(p.precio_base ?? 0),
        descuento_pct: 0,
        tasa_iva: Number(p.tasa_iva ?? 0),
        existencia: Number(p.existencia ?? 0),
        controlado: p.controlado,
      }]
    })
    setQ('')
    setResultados([])
    enfocar()
  }, [enfocar])

  const cambiarLinea = (id: string, campo: keyof Linea, valor: number) => {
    setCarrito(prev => prev.map(l => l.producto_id === id ? { ...l, [campo]: valor } : l))
  }

  const quitar = (id: string) => setCarrito(prev => prev.filter(l => l.producto_id !== id))

  // --- Búsqueda con rebote --------------------------------------------

  useEffect(() => {
    const texto = q.trim()
    if (texto.length < 2) { setResultados([]); return }

    let cancelado = false
    setBuscando(true)
    const t = setTimeout(async () => {
      consultaRef.current = texto
      const r = await buscarProductosPOS(texto, sucursal.id)
      if (cancelado) return
      setBuscando(false)
      if (r.error) { setError(r.error); return }

      // Escaneo: si el código coincide exacto, se agrega solo y se limpia.
      // Es lo que espera quien trae la pistola en la mano.
      const exacto = r.productos.find(p => p.codigo_barras && p.codigo_barras === texto)
      if (exacto && pareceCodigoBarras(texto)) { agregar(exacto); return }

      setResultados(r.productos)
    }, 250)

    return () => { cancelado = true; clearTimeout(t) }
  }, [q, sucursal.id, agregar])

  // Buscador de cliente, dentro del panel de cobro.
  useEffect(() => {
    const texto = qCliente.trim()
    if (texto.length < 2) { setClientes([]); return }
    let cancelado = false
    const t = setTimeout(async () => {
      const r = await buscarClientesPOS(texto)
      if (!cancelado) setClientes(r.clientes)
    }, 250)
    return () => { cancelado = true; clearTimeout(t) }
  }, [qCliente])

  // --- Totales ---------------------------------------------------------

  const totales = useMemo(() => {
    let subtotal = 0
    let iva = 0
    for (const l of carrito) {
      const base = redondear(l.cantidad * l.precio_unitario * (1 - l.descuento_pct / 100))
      subtotal += base
      iva += redondear(base * l.tasa_iva)
    }
    return {
      subtotal: redondear(subtotal),
      iva: redondear(iva),
      total: redondear(subtotal + iva),
    }
  }, [carrito])

  const sobregiro = carrito.filter(l => l.cantidad > l.existencia)

  // --- Cobrar ----------------------------------------------------------

  const cobrar = () => {
    setError(null)
    if (!usuario) { setError('Elige quién está en la caja antes de cobrar.'); return }
    if (!carrito.length) { setError('El carrito está vacío.'); return }

    startCobro(async () => {
      const r = await cerrarVentaPOS({
        sucursal_id: sucursal.id,
        cliente_id: cliente?.id ?? null,
        usuario,
        forma_pago: formaPago,
        dias_credito: diasCredito,
        requiere_factura: requiereFactura,
        notas: notas.trim() || null,
        items: carrito.map(l => ({
          producto_id: l.producto_id,
          descripcion: l.descripcion,
          cantidad: l.cantidad,
          precio_unitario: l.precio_unitario,
          descuento_pct: l.descuento_pct,
        })),
      })
      if (!r.ok) { setError(r.error); return }
      setTicket(r)
      setPanelCobro(false)
    })
  }

  const nuevaVenta = () => {
    setTicket(null); setCarrito([]); setCliente(null); setQCliente('')
    setFormaPago('efectivo'); setRequiereFactura(false); setNotas(''); setError(null)
    enfocar()
  }

  // --- Confirmación ----------------------------------------------------

  if (ticket) {
    return (
      <div className="p-6 md:p-8 max-w-3xl mx-auto">
        <div className="bg-white border border-emerald-200 rounded-xl overflow-hidden">
          <div className="bg-emerald-50 px-6 py-5 flex items-center gap-3 border-b border-emerald-200">
            <CheckCircleIcon className="w-9 h-9 text-emerald-600 shrink-0" />
            <div>
              <div className="text-xl font-semibold text-emerald-900">Venta registrada</div>
              <div className="text-base text-emerald-700">
                Folio {ticket.folio} · {pesos(ticket.total)}
              </div>
            </div>
          </div>

          <div className="px-6 py-5 space-y-4">
            {/* Al cliente hay que decirle el tiempo de entrega desde el
                principio, sobre todo si es nuevo (minuta 6). */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
              <div className="text-sm font-semibold text-blue-900 uppercase tracking-wide">
                Entrega comprometida
              </div>
              <div className="text-base text-blue-800 mt-0.5">{ticket.texto_entrega}</div>
            </div>

            <div>
              <div className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Salió de estos lotes
              </div>
              <div className="space-y-2">
                {ticket.items.map((it, i) => (
                  <div key={i} className="border border-gray-200 rounded-lg px-4 py-3">
                    <div className="flex justify-between gap-3">
                      <span className="font-medium text-gray-900">{it.descripcion}</span>
                      <span className="text-gray-700 whitespace-nowrap">
                        {it.cantidad} × {pesos(it.precio_unitario)}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
                      {it.lotes.length === 0 && <span>—</span>}
                      {it.lotes.map((l, j) => (
                        <span key={j} className="font-mono">
                          {l.lote ?? 's/l'} · {l.cantidad} pz
                          {l.caducidad && ` · cad. ${formatDia(l.caducidad)}`}
                        </span>
                      ))}
                      {it.tasa_iva === 0 && (
                        <span className="text-emerald-700 font-medium not-italic">sin IVA</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-gray-100 pt-4 space-y-1 text-base">
              <div className="flex justify-between text-gray-600">
                <span>Subtotal</span><span>{pesos(ticket.subtotal)}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>IVA</span><span>{pesos(ticket.iva)}</span>
              </div>
              <div className="flex justify-between text-xl font-semibold text-gray-900 pt-1">
                <span>Total</span><span>{pesos(ticket.total)}</span>
              </div>
            </div>
          </div>

          <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex flex-col sm:flex-row gap-3">
            <button
              onClick={nuevaVenta}
              className="flex-1 px-5 py-3 bg-[#003366] text-white text-base font-medium rounded-lg hover:bg-[#002244] transition-colors"
            >
              Nueva venta
            </button>
            <Link
              href={`/ventas/${ticket.venta_id}`}
              className="flex-1 text-center px-5 py-3 border border-gray-300 text-gray-700 text-base font-medium rounded-lg hover:bg-white transition-colors"
            >
              Ver la venta
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // --- Caja ------------------------------------------------------------

  const inputCls = 'w-full px-4 py-3 text-base border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366]'

  return (
    <div className="p-4 md:p-8 pb-40 lg:pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Punto de venta</h1>
          <p className="text-base text-gray-500 mt-1">
            Cobra y descuenta el inventario de {sucursal.nombre} en un solo paso.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* La plaza decide de qué inventario se descuenta (minuta 28). */}
          <select
            value={sucursal.id}
            onChange={e => fijarPlaza(e.target.value)}
            className="px-4 py-2.5 text-base border border-gray-200 rounded-lg bg-white"
          >
            {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
          {/* Quién cobra: firma el movimiento del kardex (minuta 8). */}
          <select
            value={usuario ?? ''}
            onChange={e => fijarCajero(e.target.value)}
            className={`px-4 py-2.5 text-base border rounded-lg bg-white ${
              usuario ? 'border-gray-200' : 'border-amber-300 bg-amber-50 text-amber-800'
            }`}
          >
            <option value="" disabled>¿Quién cobra?</option>
            {usuarios.map(u => <option key={u.id} value={u.nombre}>{u.nombre}</option>)}
          </select>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-4 text-base flex items-start gap-2">
          <ExclamationTriangleIcon className="w-5 h-5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid lg:grid-cols-[1fr_400px] gap-6 items-start">
        {/* Buscador + resultados */}
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                ref={inputRef}
                value={q}
                onChange={e => setQ(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && resultados.length) { e.preventDefault(); agregar(resultados[0]) }
                  if (e.key === 'Escape') { setQ(''); setResultados([]) }
                }}
                placeholder="Escanea el código o escribe el nombre..."
                autoComplete="off"
                className="w-full pl-11 pr-4 py-4 text-lg border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366]"
              />
            </div>
            <p className="text-sm text-gray-400 mt-2">
              Enter agrega el primero · Escape limpia · el escaneo se agrega solo
            </p>
          </div>

          {buscando && <div className="text-base text-gray-400 px-1">Buscando…</div>}

          <div className="space-y-2">
            {resultados.map(p => {
              const agotado = p.existencia <= 0
              return (
                <button
                  key={p.producto_id}
                  onClick={() => agregar(p)}
                  className="w-full text-left bg-white border border-gray-200 rounded-xl p-4 hover:border-[#003366]/40 hover:shadow-sm transition-all flex items-start gap-4"
                >
                  <div className="min-w-0 flex-1">
                    {/* Comercial arriba: es como lo busca el equipo (minuta 20). */}
                    <div className="font-semibold text-lg text-gray-900 flex items-center gap-2 flex-wrap">
                      {nombreProducto({
                        nombre_comercial: p.nombre_comercial,
                        nombre_generico: p.nombre_generico,
                        nombre: p.nombre,
                      })}
                      {p.controlado && (
                        <span className="text-xs font-semibold bg-red-100 text-red-700 px-2 py-0.5 rounded">
                          CONTROLADO
                        </span>
                      )}
                    </div>
                    <div className="text-base text-gray-500 mt-0.5">
                      {[p.nombre_generico, p.concentracion, p.forma_farmaceutica, p.presentacion]
                        .filter(Boolean).join(' · ') || '—'}
                    </div>
                    {/* Si no hay aquí pero sí en la otra plaza, hay que decirlo
                        antes de que el cliente cuelgue (minuta 28). */}
                    {p.existencia_otras > 0 && (
                      <div className="text-sm text-teal-700 font-medium mt-1">
                        También hay {p.existencia_otras} en otra plaza
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`text-xl font-semibold ${
                      agotado ? 'text-red-500' : p.existencia < 10 ? 'text-amber-600' : 'text-gray-900'
                    }`}>
                      {p.existencia}
                    </div>
                    <div className="text-sm text-gray-400">piezas</div>
                    {p.precio_base != null && (
                      <div className="text-base font-medium text-gray-700 mt-1">
                        {pesos(p.precio_base)}
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
            {!buscando && q.trim().length >= 2 && resultados.length === 0 && (
              <div className="bg-white border border-gray-200 rounded-xl py-12 text-center text-gray-400 text-base">
                Sin resultados para “{q.trim()}”.
              </div>
            )}
          </div>
        </div>

        {/* Carrito */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden lg:sticky lg:top-4">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <ShoppingCartIcon className="w-5 h-5 text-gray-400" />
            <span className="text-base font-semibold text-gray-900">
              Carrito {carrito.length > 0 && `· ${carrito.length}`}
            </span>
            {carrito.length > 0 && (
              <button
                onClick={() => setCarrito([])}
                className="ml-auto text-sm font-medium text-gray-400 hover:text-red-600 transition-colors"
              >
                Vaciar
              </button>
            )}
          </div>

          <div className="divide-y divide-gray-50 max-h-[50vh] overflow-y-auto">
            {carrito.length === 0 && (
              <div className="py-16 text-center text-gray-400 text-base px-5">
                Escanea o busca un producto para empezar.
              </div>
            )}
            {carrito.map(l => {
              const base = redondear(l.cantidad * l.precio_unitario * (1 - l.descuento_pct / 100))
              const excede = l.cantidad > l.existencia
              return (
                <div key={l.producto_id} className="px-5 py-4">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-base text-gray-900 truncate">{l.descripcion}</div>
                      <div className="text-sm text-gray-400">
                        {l.existencia} disponibles
                        {/* La mayoría de sus productos no causa IVA (minuta 3). */}
                        {l.tasa_iva === 0
                          ? <span className="text-emerald-700 font-medium"> · sin IVA</span>
                          : <span> · IVA {(l.tasa_iva * 100).toFixed(0)}%</span>}
                      </div>
                    </div>
                    <button
                      onClick={() => quitar(l.producto_id)}
                      className="text-gray-300 hover:text-red-600 transition-colors p-1"
                      aria-label="Quitar"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex items-center gap-2 mt-3">
                    {/* Botones grandes: esto se usa con el dedo (minuta 11). */}
                    <div className="flex items-center border border-gray-200 rounded-lg">
                      <button
                        onClick={() => cambiarLinea(l.producto_id, 'cantidad', Math.max(1, l.cantidad - 1))}
                        className="px-3 py-2.5 text-gray-500 hover:bg-gray-50 rounded-l-lg"
                        aria-label="Menos"
                      >
                        <MinusIcon className="w-4 h-4" />
                      </button>
                      <input
                        type="number" min={1} value={l.cantidad}
                        onChange={e => cambiarLinea(l.producto_id, 'cantidad', Math.max(1, Number(e.target.value) || 1))}
                        className="w-14 text-center text-base font-semibold border-x border-gray-200 py-2.5 focus:outline-none"
                      />
                      <button
                        onClick={() => cambiarLinea(l.producto_id, 'cantidad', l.cantidad + 1)}
                        className="px-3 py-2.5 text-gray-500 hover:bg-gray-50 rounded-r-lg"
                        aria-label="Más"
                      >
                        <PlusIcon className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-base">$</span>
                      <input
                        type="number" min={0} step="0.01" value={l.precio_unitario}
                        onChange={e => cambiarLinea(l.producto_id, 'precio_unitario', Number(e.target.value) || 0)}
                        className="w-full pl-7 pr-2 py-2.5 text-base border border-gray-200 rounded-lg focus:outline-none focus:border-[#003366]"
                      />
                    </div>
                    <div className="relative w-20">
                      <input
                        type="number" min={0} max={100} value={l.descuento_pct}
                        onChange={e => cambiarLinea(l.producto_id, 'descuento_pct', Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
                        className="w-full pl-2 pr-6 py-2.5 text-base border border-gray-200 rounded-lg focus:outline-none focus:border-[#003366]"
                      />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
                    </div>
                  </div>

                  <div className="flex justify-between items-center mt-2">
                    {excede ? (
                      <span className="text-sm font-medium text-red-600">
                        Sólo hay {l.existencia} en {sucursal.clave}
                      </span>
                    ) : <span />}
                    <span className="text-base font-semibold text-gray-900">{pesos(base)}</span>
                  </div>
                </div>
              )
            })}
          </div>

          {carrito.length > 0 && (
            <div className="px-5 py-4 bg-gray-50 border-t border-gray-200 space-y-1">
              <div className="flex justify-between text-base text-gray-600">
                <span>Subtotal</span><span>{pesos(totales.subtotal)}</span>
              </div>
              <div className="flex justify-between text-base text-gray-600">
                <span>IVA</span><span>{pesos(totales.iva)}</span>
              </div>
              <div className="flex justify-between text-xl font-semibold text-gray-900 pt-1">
                <span>Total</span><span>{pesos(totales.total)}</span>
              </div>
              <button
                onClick={() => setPanelCobro(true)}
                disabled={sobregiro.length > 0}
                className="hidden lg:block w-full mt-3 px-5 py-3.5 bg-[#003366] text-white text-base font-semibold rounded-lg hover:bg-[#002244] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Cobrar {pesos(totales.total)}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Barra fija del celular */}
      {carrito.length > 0 && (
        <div className="lg:hidden fixed bottom-16 left-0 right-0 z-40 bg-white border-t border-gray-200 px-4 py-3 flex items-center gap-3 shadow-lg">
          <div className="min-w-0">
            <div className="text-sm text-gray-500">{carrito.length} partidas</div>
            <div className="text-xl font-semibold text-gray-900">{pesos(totales.total)}</div>
          </div>
          <button
            onClick={() => setPanelCobro(true)}
            disabled={sobregiro.length > 0}
            className="ml-auto px-6 py-3.5 bg-[#003366] text-white text-base font-semibold rounded-lg disabled:opacity-40 transition-colors"
          >
            Cobrar
          </button>
        </div>
      )}

      {/* Panel de cobro */}
      {panelCobro && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full sm:max-w-lg sm:rounded-xl rounded-t-2xl max-h-[92vh] overflow-y-auto">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white">
              <h2 className="text-lg font-semibold text-gray-900">Cobrar {pesos(totales.total)}</h2>
              <button onClick={() => setPanelCobro(false)} className="text-gray-400 hover:text-gray-700 p-1">
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-base">
                  {error}
                </div>
              )}

              {/* Cliente */}
              <div>
                <label className="block text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Cliente
                </label>
                {cliente ? (
                  <div className="flex items-center gap-3 border border-gray-200 rounded-lg px-4 py-3">
                    <UserIcon className="w-5 h-5 text-gray-400 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-base text-gray-900 truncate">
                        {cliente.empresa ?? cliente.nombre}
                      </div>
                      {(cliente.dias_credito ?? 0) > 0 && (
                        <div className="text-sm text-gray-500">
                          Crédito a {cliente.dias_credito} días
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => { setCliente(null); setQCliente('') }}
                      className="text-sm font-medium text-gray-400 hover:text-red-600"
                    >
                      Quitar
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      value={qCliente}
                      onChange={e => setQCliente(e.target.value)}
                      placeholder="Buscar por nombre o empresa (opcional)"
                      className={inputCls}
                    />
                    {clientes.length > 0 && (
                      <div className="mt-2 border border-gray-200 rounded-lg divide-y divide-gray-50 max-h-48 overflow-y-auto">
                        {clientes.map(c => (
                          <button
                            key={c.id}
                            onClick={() => {
                              setCliente(c)
                              setClientes([])
                              // El plazo pactado con el cliente manda (minuta 34).
                              if ((c.dias_credito ?? 0) > 0) {
                                setFormaPago('credito')
                                setDiasCredito(c.dias_credito as number)
                              }
                              if (c.requiere_factura) setRequiereFactura(true)
                            }}
                            className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors"
                          >
                            <div className="font-medium text-base text-gray-900">
                              {c.empresa ?? c.nombre}
                            </div>
                            <div className="text-sm text-gray-500">
                              {[c.nombre !== c.empresa ? c.nombre : null, c.ciudad]
                                .filter(Boolean).join(' · ') || '—'}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    <p className="text-sm text-gray-400 mt-1.5">
                      Sin cliente se registra como venta de mostrador.
                    </p>
                  </>
                )}
              </div>

              {/* Forma de pago */}
              <div>
                <label className="block text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Forma de pago
                </label>
                <div className="flex flex-wrap gap-2">
                  {FORMAS_PAGO.map(f => (
                    <button
                      key={f.valor}
                      onClick={() => setFormaPago(f.valor)}
                      className={`px-4 py-2.5 rounded-lg text-base font-medium border transition-colors ${
                        formaPago === f.valor
                          ? 'bg-[#003366] text-white border-[#003366]'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                {formaPago === 'credito' && (
                  <div className="mt-3">
                    <label className="block text-sm text-gray-500 mb-1.5">Días de plazo</label>
                    <div className="flex flex-wrap gap-2">
                      {DIAS_CREDITO.map(d => (
                        <button
                          key={d}
                          onClick={() => setDiasCredito(d)}
                          className={`px-4 py-2 rounded-lg text-base font-medium border transition-colors ${
                            diasCredito === d
                              ? 'bg-[#003366] text-white border-[#003366]'
                              : 'bg-white text-gray-600 border-gray-200'
                          }`}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={requiereFactura}
                  onChange={e => setRequiereFactura(e.target.checked)}
                  className="w-5 h-5 rounded border-gray-300 text-[#003366] focus:ring-[#003366]/20"
                />
                <span className="text-base text-gray-700">Requiere factura</span>
              </label>

              <div>
                <label className="block text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Notas
                </label>
                <textarea
                  value={notas}
                  onChange={e => setNotas(e.target.value)}
                  rows={2}
                  className={inputCls}
                  placeholder="Opcional"
                />
              </div>
            </div>

            <div className="px-5 py-4 bg-gray-50 border-t border-gray-200 sticky bottom-0">
              <button
                onClick={cobrar}
                disabled={cobrando}
                className="w-full px-5 py-4 bg-[#003366] text-white text-lg font-semibold rounded-lg hover:bg-[#002244] disabled:opacity-50 transition-colors"
              >
                {cobrando ? 'Registrando…' : `Cerrar venta · ${pesos(totales.total)}`}
              </button>
              <p className="text-sm text-gray-400 text-center mt-2">
                Descuenta el inventario del lote que caduca primero.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
