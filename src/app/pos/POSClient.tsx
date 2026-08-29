'use client'

// La caja (minuta 11, 16, 22, 23, 3; puntos 2 y 7 del cliente).
//
// Cinco decisiones que explican cómo está armado:
//
//  1. Un solo campo de búsqueda para la pistola y para el teclado. El RPC
//     acepta nombre o código de barras y le da score 2.00 al código exacto,
//     así que se distingue el escaneo sin cambiar de modo (minuta 22).
//  2. El IVA no se calcula con una constante: cada partida trae la tasa de
//     su producto. La mayoría de lo que venden va en 0% (minuta 3).
//  3. El total y el botón de cobrar viven en una barra fija abajo en el
//     celular. Lo usan desde el teléfono, no sólo desde la computadora.
//  4. Si el código escaneado no existe en ningún producto, la venta NO se
//     atora: se liga aquí mismo, por nombre, y el producto entra al carrito
//     (punto 2 — 49 de los 128 productos todavía no tienen código).
//  5. El sobregiro AVISA pero no bloquea, y la existencia se puede refrescar
//     (punto 7). Ver el comentario largo junto a `sobregiro`.

import { useState, useEffect, useRef, useTransition, useMemo, useCallback } from 'react'
import Link from 'next/link'
import {
  MagnifyingGlassIcon, PlusIcon, MinusIcon, XMarkIcon, TrashIcon, PrinterIcon,
  ArrowPathIcon, LinkIcon,
} from '@heroicons/react/20/solid'
import {
  ShoppingCartIcon, CheckCircleIcon, ExclamationTriangleIcon, UserIcon,
} from '@heroicons/react/24/outline'
import { pesos, formatDia, nombreProducto } from '@/lib/utils'
import { FORMAS_PAGO, DIAS_CREDITO } from '@/lib/constantes'
import type { ProductoPOS, FormaPago, UsuarioPanel } from '@/lib/types'
import {
  buscarProductosPOS, buscarClientesPOS, cerrarVentaPOS, fijarCajero, fijarPlaza,
  refrescarExistencias, ligarCodigoPOS,
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
  // Lo que hay en las demás plazas. Sirve para el aviso de sobregiro: no es
  // lo mismo "no hay en ningún lado" que "no hay aquí, hay 8 en la otra".
  existencia_otras: number
  controlado: boolean
}

const redondear = (n: number) => Math.round(n * 100) / 100

// Una cadena de puros dígitos y larga viene de la pistola, no del teclado.
const pareceCodigoBarras = (s: string) => /^\d{8,}$/.test(s.trim())

// Un código de barras de producto trae entre 8 y 14 dígitos (EAN-8, UPC-A,
// EAN-13, ITF-14). Más largo que eso no es un código: casi siempre es el
// lector pegándole un prefijo, y ligarlo sólo ensuciaría el catálogo.
const esCodigoLigable = (s: string) => /^\d{8,14}$/.test(s.trim())

const hora = (t: number) =>
  new Date(t).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })

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

  // Existencia al día (punto 7)
  const [refrescando, setRefrescando] = useState(false)
  const [refrescadoEn, setRefrescadoEn] = useState<number | null>(null)

  // Código escaneado que no está en ningún producto (punto 2)
  const [codigoHuerfano, setCodigoHuerfano] = useState<string | null>(null)
  const [qLigar, setQLigar] = useState('')
  const [resLigar, setResLigar] = useState<ProductoPOS[]>([])
  const [selLigar, setSelLigar] = useState(0)
  const [buscandoLigar, setBuscandoLigar] = useState(false)
  const [ligando, startLigado] = useTransition()
  const [avisoLigado, setAvisoLigado] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const ligarRef = useRef<HTMLInputElement>(null)
  // El texto que disparó la última búsqueda, para reconocer el escaneo
  // cuando llega la respuesta.
  const consultaRef = useRef('')
  // Espejo del carrito para poder refrescar existencias desde efectos que no
  // deben volver a correr cada vez que cambia una cantidad.
  const carritoRef = useRef<Linea[]>([])

  const enfocar = useCallback(() => inputRef.current?.focus(), [])

  useEffect(() => { enfocar() }, [enfocar])
  useEffect(() => { carritoRef.current = carrito }, [carrito])

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
        existencia_otras: Number(p.existencia_otras ?? 0),
        controlado: p.controlado,
      }]
    })
    setQ('')
    setResultados([])
    enfocar()
  }, [enfocar])

  // --- Existencia al día (punto 7) -------------------------------------
  //
  // La existencia de cada partida se copió al carrito cuando el producto
  // entró. Desde entonces pudo cambiar: otra caja vendió, llegó mercancía,
  // o el dato simplemente estaba mal. Volver a preguntarla es lo que hace
  // que el aviso de sobregiro valga algo.
  const refrescarCarrito = useCallback(async () => {
    const ids = carritoRef.current.map(l => l.producto_id)
    if (!ids.length) return
    setRefrescando(true)
    const r = await refrescarExistencias(ids, sucursal.id)
    setRefrescando(false)
    if (r.error) { setError(r.error); return }
    setCarrito(prev => prev.map(l => {
      const e = r.existencias[l.producto_id]
      return e ? { ...l, existencia: e.existencia, existencia_otras: e.existencia_otras } : l
    }))
    setRefrescadoEn(Date.now())
  }, [sucursal.id])

  // Al cambiar de plaza el inventario es OTRO: lo que había en GDL no dice
  // nada de lo que hay en MTY.
  useEffect(() => {
    if (carritoRef.current.length) void refrescarCarrito()
  }, [refrescarCarrito])

  const abrirCobro = () => {
    setPanelCobro(true)
    // Última lectura antes de comprometer la venta.
    void refrescarCarrito()
  }

  const cambiarLinea = (id: string, campo: keyof Linea, valor: number) => {
    setCarrito(prev => prev.map(l => l.producto_id === id ? { ...l, [campo]: valor } : l))
  }

  const quitar = (id: string) => setCarrito(prev => prev.filter(l => l.producto_id !== id))

  // --- Búsqueda con rebote --------------------------------------------

  useEffect(() => {
    const texto = q.trim()
    // Apagar el indicador aquí también: si no, borrar hasta dejar una letra
    // deja "Buscando..." encendido para siempre y parece que se colgó.
    if (texto.length < 2) { setResultados([]); setBuscando(false); return }

    let cancelado = false
    setBuscando(true)
    const t = setTimeout(async () => {
      consultaRef.current = texto
      const r = await buscarProductosPOS(texto, sucursal.id)
      if (cancelado) return
      setBuscando(false)
      if (r.error) { setError(r.error); return }
      setError(null)

      // Escaneo: si el código coincide exacto, se agrega solo y se limpia.
      // Es lo que espera quien trae la pistola en la mano.
      //
      // PERO puede haber más de un producto con el mismo código de barras
      // (no debería, pero la columna no tiene índice único; los que quedan
      // se ven en la vista v_productos_duplicados). En ese caso no se puede
      // adivinar cuál quiso decir la persona: se le muestran los dos (o
      // más) para que elija, en vez de agregar el primero en silencio.
      const exactos = r.productos.filter(p => p.codigo_barras && p.codigo_barras === texto)

      // Una búsqueda nueva cancela el ligado que hubiera pendiente.
      setCodigoHuerfano(null)

      if (pareceCodigoBarras(texto) && exactos.length === 1) { agregar(exactos[0]); return }
      if (pareceCodigoBarras(texto) && exactos.length > 1) {
        setResultados(exactos)
        setError(
          `El código ${texto} está asignado a ${exactos.length} productos distintos. ` +
          `Elige cuál es abajo — hay que corregir esto en el catálogo cuando se pueda.`
        )
        return
      }

      // Escaneo de una caja cuyo código no está registrado (punto 2). Es el
      // caso de 49 de los 128 productos: sin esto la venta se atora con el
      // cliente enfrente. Se ofrece ligarlo sin salir de la caja.
      if (pareceCodigoBarras(texto) && exactos.length === 0) {
        if (!esCodigoLigable(texto)) {
          setError(
            `El código ${texto} no está registrado en ningún producto, y trae ${texto.length} dígitos: ` +
            'un código de barras de producto tiene entre 8 y 14. Lo más probable es que el lector le ' +
            'esté pegando un prefijo — revísalo antes de ligarlo a nada.'
          )
          setResultados([])
          return
        }
        setCodigoHuerfano(texto)
        setResultados([])
        setQLigar('')
        setSelLigar(0)
        // El campo queda libre para el siguiente disparo del lector.
        setQ('')
        setTimeout(() => ligarRef.current?.focus(), 40)
        return
      }

      setResultados(r.productos)
    }, 250)

    return () => { cancelado = true; clearTimeout(t) }
  }, [q, sucursal.id, agregar])

  // --- Ligar el código huérfano: buscador por nombre --------------------

  useEffect(() => {
    if (!codigoHuerfano) { setResLigar([]); setBuscandoLigar(false); return }
    const texto = qLigar.trim()
    if (texto.length < 2) { setResLigar([]); setBuscandoLigar(false); return }

    let cancelado = false
    setBuscandoLigar(true)
    const t = setTimeout(async () => {
      const r = await buscarProductosPOS(texto, sucursal.id)
      if (cancelado) return
      setBuscandoLigar(false)
      if (r.error) { setError(r.error); return }
      setResLigar(r.productos)
      setSelLigar(0)
    }, 250)

    return () => { cancelado = true; clearTimeout(t) }
  }, [qLigar, codigoHuerfano, sucursal.id])

  const ligar = (p: ProductoPOS) => {
    const codigo = codigoHuerfano
    if (!codigo) return
    setError(null)
    startLigado(async () => {
      const r = await ligarCodigoPOS(p.producto_id, codigo, sucursal.id)
      if (!r.ok) { setError(r.error); return }
      setCodigoHuerfano(null)
      setQLigar(''); setResLigar([]); setSelLigar(0)
      setAvisoLigado(
        `Listo: ${codigo} quedó ligado a ${nombreProducto(r.producto)}. ` +
        `La próxima vez que escanees esa caja, entra sola.` + (r.aviso ? ` ${r.aviso}` : '')
      )
      // Y sigue la venta: el producto entra al carrito.
      agregar(r.producto)
    })
  }

  const cancelarLigado = () => {
    setCodigoHuerfano(null); setQLigar(''); setResLigar([]); setSelLigar(0)
    enfocar()
  }

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

  // --- Sobregiro (punto 7) ---------------------------------------------
  //
  // AVISA, PERO NO BLOQUEA. A propósito.
  //
  // El mostrador tiene que poder vender aunque el sistema crea que no hay:
  // la caja está viendo la caja de medicamento en la mano y el sistema está
  // viendo un número que pudo quedarse atrás. Quien decide es la persona,
  // no el dato. Antes esto deshabilitaba el botón de cobrar, y por eso en la
  // computadora del cliente alguien terminó desactivando la validación
  // entera (`const excede = false`) con tal de poder seguir vendiendo.
  //
  // El freno de verdad está en la base: `descontar_fefo` y
  // `registrar_movimiento` no dejan la existencia en negativo, y su
  // `raise exception` ya viene redactado en español ("Existencia insuficiente
  // en esta plaza: hay 3 y se piden 5."). Si la venta no debe pasar, la
  // rechaza allá y aquí se muestra ese mensaje tal cual, con el número real.
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
      // Si la base rechaza por existencia, su mensaje ya viene en español
      // ("Existencia insuficiente en esta plaza: hay 3 y se piden 5.").
      // Se muestra tal cual: dice el número real, que es justo lo que la
      // caja necesita saber para decidir.
      if (!r.ok) { setError(r.error); void refrescarCarrito(); return }
      setTicket(r)
      setPanelCobro(false)
    })
  }

  const nuevaVenta = () => {
    setTicket(null); setCarrito([]); setCliente(null); setQCliente('')
    setFormaPago('efectivo'); setRequiereFactura(false); setNotas(''); setError(null)
    setCodigoHuerfano(null); setQLigar(''); setResLigar([]); setAvisoLigado(null)
    setRefrescadoEn(null)
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
            {/* Se abre en ventana aparte y se imprime solo: la caja no pierde
                el foco del buscador ni el carrito de la siguiente venta. */}
            <button
              onClick={() => window.open(`/ventas/${ticket.venta_id}/ticket?auto=1`, '_blank', 'width=420,height=640')}
              className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 border border-gray-300 text-gray-700 text-base font-medium rounded-lg hover:bg-white transition-colors"
            >
              <PrinterIcon className="w-5 h-5 text-gray-400" />
              Imprimir ticket
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
    <div className="p-4 md:p-6 xl:p-8 pb-44 xl:pb-8">
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

      <div className="grid xl:grid-cols-[1fr_380px] gap-5 xl:gap-6 items-start">
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

          {/* Confirmación de que el código quedó pegado al producto. */}
          {avisoLigado && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-base text-emerald-900 flex items-start gap-2">
              <CheckCircleIcon className="w-5 h-5 shrink-0 mt-0.5 text-emerald-600" />
              <span className="flex-1">{avisoLigado}</span>
              <button
                onClick={() => setAvisoLigado(null)}
                className="shrink-0 text-emerald-500 hover:text-emerald-800"
                aria-label="Cerrar aviso"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
          )}

          {/* --- Código escaneado que no existe todavía (punto 2) --------- */}
          {codigoHuerfano && (
            <div className="bg-white border-2 border-amber-300 rounded-xl overflow-hidden">
              <div className="bg-amber-50 border-b border-amber-200 px-5 py-4">
                <div className="flex items-start gap-3">
                  <ExclamationTriangleIcon className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="text-lg font-semibold text-amber-900">
                      El código <span className="font-mono">{codigoHuerfano}</span> no está
                      registrado en ningún producto
                    </div>
                    <p className="text-base text-amber-800 mt-1">
                      Busca el medicamento por su nombre y elígelo: el código le queda pegado y
                      el producto entra a esta venta. No hay que salir de la caja.
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-4">
                <input
                  ref={ligarRef}
                  value={qLigar}
                  onChange={e => setQLigar(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'ArrowDown') { e.preventDefault(); setSelLigar(s => Math.min(s + 1, resLigar.length - 1)) }
                    if (e.key === 'ArrowUp')   { e.preventDefault(); setSelLigar(s => Math.max(s - 1, 0)) }
                    if (e.key === 'Enter')     { e.preventDefault(); const p = resLigar[selLigar]; if (p && !ligando) ligar(p) }
                    if (e.key === 'Escape')    { e.preventDefault(); cancelarLigado() }
                  }}
                  placeholder="Nombre del medicamento…"
                  autoComplete="off"
                  className="w-full px-4 py-3.5 text-lg border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366]"
                />
                <p className="text-sm text-gray-500 mt-2">
                  Flechas para moverte · Enter para ligar y agregar · Escape para cancelar
                </p>
              </div>

              <div className="border-t border-gray-100 divide-y divide-gray-50 max-h-[38vh] overflow-y-auto">
                {buscandoLigar && resLigar.length === 0 && (
                  <div className="px-5 py-4 text-base text-gray-400">Buscando…</div>
                )}
                {!buscandoLigar && qLigar.trim().length >= 2 && resLigar.length === 0 && (
                  <div className="px-5 py-8 text-center text-base text-gray-400">
                    Ningún medicamento coincide. Prueba con el nombre comercial.
                  </div>
                )}
                {resLigar.map((p, i) => (
                  <button
                    key={p.producto_id}
                    onMouseEnter={() => setSelLigar(i)}
                    onClick={() => ligar(p)}
                    disabled={ligando}
                    className={`w-full text-left px-5 py-4 transition-colors disabled:opacity-50 ${
                      i === selLigar ? 'bg-[#003366]/8' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="text-lg font-semibold text-gray-900">
                        {nombreProducto(p)}
                      </span>
                      {/* Si ya tenía otro código, se le reemplaza: hay que verlo antes. */}
                      {p.codigo_barras && (
                        <span className="text-sm font-mono text-amber-700 shrink-0">
                          ya tiene {p.codigo_barras}
                        </span>
                      )}
                    </div>
                    <div className="text-base text-gray-600 mt-0.5">
                      {[p.nombre_generico, p.concentracion, p.presentacion, p.laboratorio]
                        .filter(Boolean).join(' · ') || '—'}
                      <span className="text-gray-400"> · {p.existencia} pz en {sucursal.clave}</span>
                    </div>
                  </button>
                ))}
              </div>

              <div className="px-5 py-3 bg-gray-50 border-t border-gray-200 flex items-center gap-3">
                <LinkIcon className="w-5 h-5 text-gray-400 shrink-0" />
                <span className="text-sm text-gray-500 flex-1">
                  {ligando ? 'Ligando el código…' : 'Queda guardado para siempre en el catálogo.'}
                </span>
                <button
                  onClick={cancelarLigado}
                  className="px-4 py-2 border border-gray-300 text-gray-700 text-base font-medium rounded-lg hover:bg-white transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

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
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden xl:sticky xl:top-4">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2 flex-wrap">
            <ShoppingCartIcon className="w-5 h-5 text-gray-400" />
            <span className="text-base font-semibold text-gray-900">
              Carrito {carrito.length > 0 && `· ${carrito.length}`}
            </span>
            {carrito.length > 0 && (
              <>
                {/* Punto 7: la existencia del carrito se puede volver a
                    preguntar sin perder la venta que se está capturando. */}
                <button
                  onClick={() => void refrescarCarrito()}
                  disabled={refrescando}
                  className="ml-auto inline-flex items-center gap-1.5 text-sm font-medium text-[#003366] hover:underline disabled:opacity-50"
                >
                  <ArrowPathIcon className={`w-4 h-4 ${refrescando ? 'animate-spin' : ''}`} />
                  {refrescando ? 'Revisando…' : 'Revisar existencias'}
                </button>
                <button
                  onClick={() => setCarrito([])}
                  className="text-sm font-medium text-gray-400 hover:text-red-600 transition-colors"
                >
                  Vaciar
                </button>
              </>
            )}
            {carrito.length > 0 && refrescadoEn && (
              <div className="w-full text-sm text-gray-400">
                Existencias revisadas a las {hora(refrescadoEn)} en {sucursal.clave}
              </div>
            )}
          </div>

          <div className="divide-y divide-gray-50 max-h-[42vh] xl:max-h-[50vh] overflow-y-auto">
            {carrito.length === 0 && (
              <div className="py-16 text-center text-gray-400 text-base px-5">
                Escanea o busca un producto para empezar.
              </div>
            )}
            {carrito.map(l => {
              const base = redondear(l.cantidad * l.precio_unitario * (1 - l.descuento_pct / 100))
              // Avisa, no bloquea: ver el comentario de `sobregiro`.
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

                  <div className="flex justify-between items-start gap-3 mt-2">
                    {excede ? (
                      <span className="text-sm font-medium text-amber-700">
                        El sistema sólo tiene {l.existencia} en {sucursal.clave}
                        {l.existencia_otras > 0 && ` (${l.existencia_otras} en la otra plaza)`}
                        . Si en el anaquel sí hay, véndelo.
                      </span>
                    ) : <span />}
                    <span className="text-base font-semibold text-gray-900 whitespace-nowrap">{pesos(base)}</span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* El sobregiro se ve, pero el botón sigue vivo (punto 7). */}
          {sobregiro.length > 0 && (
            <div className="px-5 py-3 bg-amber-50 border-t border-amber-200 text-sm text-amber-900">
              <div className="font-semibold">
                {sobregiro.length === 1
                  ? 'Una partida pide más de lo que el sistema tiene'
                  : `${sobregiro.length} partidas piden más de lo que el sistema tiene`}
              </div>
              <p className="mt-1">
                Si en el anaquel sí está, cobra: manda la venta y el sistema se acomoda. Si crees
                que el número está viejo, dale a <strong>Revisar existencias</strong>.
              </p>
            </div>
          )}

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
                onClick={abrirCobro}
                className="hidden xl:block w-full mt-3 px-5 py-3.5 bg-[#003366] text-white text-base font-semibold rounded-lg hover:bg-[#002244] transition-colors"
              >
                Cobrar {pesos(totales.total)}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Barra fija del celular */}
      {carrito.length > 0 && (
        <div className="xl:hidden fixed bottom-16 md:bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 px-4 py-3 flex items-center gap-3 shadow-lg">
          <div className="min-w-0">
            <div className="text-sm text-gray-500">{carrito.length} partidas</div>
            <div className="text-xl font-semibold text-gray-900">{pesos(totales.total)}</div>
          </div>
          <button
            onClick={abrirCobro}
            className="ml-auto px-6 py-3.5 bg-[#003366] text-white text-base font-semibold rounded-lg transition-colors"
          >
            Cobrar
          </button>
        </div>
      )}

      {/* Panel de cobro */}
      {panelCobro && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full sm:max-w-lg sm:rounded-xl rounded-t-2xl max-h-[94vh] overflow-y-auto">
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

              {/* Al abrir este panel se releyeron las existencias. Si aun así
                  alguna partida se pasa, se dice y se deja seguir. */}
              {sobregiro.length > 0 && (
                <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 text-base text-amber-900">
                  <div className="font-semibold mb-1">Ojo con la existencia</div>
                  <ul className="space-y-0.5">
                    {sobregiro.map(l => (
                      <li key={l.producto_id}>
                        {l.descripcion}: se piden {l.cantidad} y el sistema tiene {l.existencia}
                        {l.existencia_otras > 0 && ` (${l.existencia_otras} en la otra plaza)`}.
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-sm">
                    Puedes cobrar de todos modos: quien tiene la caja en la mano eres tú.
                  </p>
                </div>
              )}

              {refrescando && (
                <div className="text-base text-gray-400">Revisando existencias…</div>
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
