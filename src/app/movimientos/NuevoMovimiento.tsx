'use client'

// Alta rápida de entrada, salida y ajuste (minuta 10).
//
// Es la pantalla que sustituye la libreta: se busca el producto, se dice de
// QUÉ lote entra o sale (minuta 23), cuánto y por qué. La cantidad se manda
// sin signo; el servidor la firma. Y no se puede guardar sin decir quién lo
// hace (minuta 8).

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  PlusIcon, MagnifyingGlassIcon, XMarkIcon, CheckCircleIcon,
} from '@heroicons/react/20/solid'
import { MOTIVOS_ENTRADA, MOTIVOS_SALIDA, UBICACIONES } from '@/lib/constantes'
import { formatDia, nombreProducto } from '@/lib/utils'
import type { ProductoPOS, UsuarioPanel } from '@/lib/types'
import {
  buscarProductos, elegirUsuario, lotesDeProducto, registrarMovimiento,
  type LoteDisponible, type MovimientoManual, type Resultado, type TipoManual,
} from './acciones'

interface PlazaOpcion {
  id: string
  clave: string
  nombre: string
}

interface Props {
  /** Quién firma. null = todavía no se ha elegido y no se puede guardar. */
  usuario: string | null
  usuarios: UsuarioPanel[]
  sucursales: PlazaOpcion[]
  sucursalInicial: string
}

const TIPOS: { valor: TipoManual; label: string; ayuda: string }[] = [
  { valor: 'entrada', label: 'Entrada', ayuda: 'Llegó mercancía' },
  { valor: 'salida', label: 'Salida', ayuda: 'Salió mercancía' },
  { valor: 'ajuste', label: 'Ajuste', ayuda: 'Cuadrar con el conteo' },
]

// Un ajuste no compra ni vende: corrige lo que dice el sistema contra lo que
// hay en el anaquel. Por eso sólo se ofrecen los motivos de corrección de las
// dos listas de la libreta.
const MOTIVOS_AJUSTE = [...MOTIVOS_ENTRADA, ...MOTIVOS_SALIDA].filter(
  (m, i, todos) => todos.indexOf(m) === i && /ajuste|correcci|merma|caducado/i.test(m)
)

const OTRO = '__otro__'

const inputCls =
  'w-full px-4 py-3 text-base border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366]'
const selectCls = inputCls + ' bg-white'
const labelCls = 'block text-sm font-medium text-gray-600 mb-1.5'

const opcionCls = (activo: boolean) =>
  `w-full text-left px-4 py-3 rounded-lg border text-base transition-colors ${
    activo
      ? 'border-[#003366] bg-[#003366]/5 ring-1 ring-[#003366]/30'
      : 'border-gray-200 bg-white hover:border-gray-300'
  }`

const tresDecimales = (n: number) => Math.round(n * 1000) / 1000

const piezas = (n: number) =>
  Number.isInteger(n) ? n.toLocaleString('es-MX') : tresDecimales(n).toLocaleString('es-MX')

export default function NuevoMovimiento({ usuario, usuarios, sucursales, sucursalInicial }: Props) {
  const router = useRouter()

  const [firma, setFirma] = useState<string | null>(usuario)
  useEffect(() => { setFirma(usuario) }, [usuario])

  const [abierto, setAbierto] = useState(false)
  const [tipo, setTipo] = useState<TipoManual>('entrada')
  const [sucursalId, setSucursalId] = useState(sucursalInicial)

  // Búsqueda de producto
  const [busqueda, setBusqueda] = useState('')
  const [resultados, setResultados] = useState<ProductoPOS[]>([])
  const [buscando, setBuscando] = useState(false)
  const [producto, setProducto] = useState<ProductoPOS | null>(null)

  // Lotes de la plaza elegida
  const [lotes, setLotes] = useState<LoteDisponible[]>([])
  const [cargandoLotes, setCargandoLotes] = useState(false)
  const [recarga, setRecarga] = useState(0)
  // '' = sin elegir · 'nuevo' = lote nuevo · 'fefo' = el que caduca primero
  const [loteSel, setLoteSel] = useState('')
  const [loteNuevo, setLoteNuevo] = useState('')
  const [caducidadNueva, setCaducidadNueva] = useState('')
  const [ubicacionNueva, setUbicacionNueva] = useState('')

  const [cantidad, setCantidad] = useState('')
  const [motivoSel, setMotivoSel] = useState('')
  const [motivoOtro, setMotivoOtro] = useState('')
  const [costo, setCosto] = useState('')

  const [guardando, setGuardando] = useState(false)
  const [pendiente, startTransition] = useTransition()
  const [resultado, setResultado] = useState<Resultado | null>(null)

  const ocupado = guardando || pendiente

  // ---- Buscador con debounce -------------------------------------------
  useEffect(() => {
    const q = busqueda.trim()
    if (q.length < 2) {
      setResultados([])
      setBuscando(false)
      return
    }
    let vivo = true
    setBuscando(true)
    const t = setTimeout(async () => {
      const r = await buscarProductos(q, sucursalId)
      if (!vivo) return
      setResultados(r.productos)
      setBuscando(false)
      if (r.error) setResultado({ error: r.error })
    }, 300)
    return () => { vivo = false; clearTimeout(t) }
  }, [busqueda, sucursalId])

  // ---- Lotes del producto en la plaza elegida --------------------------
  useEffect(() => {
    if (!producto || !sucursalId) {
      setLotes([])
      return
    }
    let vivo = true
    setCargandoLotes(true)
    lotesDeProducto(producto.producto_id, sucursalId).then(r => {
      if (!vivo) return
      setLotes(r.lotes)
      setCargandoLotes(false)
      if (r.error) setResultado({ error: r.error })
    })
    return () => { vivo = false }
  }, [producto, sucursalId, recarga])

  // ---- Derivados --------------------------------------------------------
  const loteElegido = lotes.find(l => l.inventario_id === loteSel) ?? null
  const usaLoteNuevo = loteSel === 'nuevo'
  const usaFefo = tipo === 'salida' && loteSel === 'fefo'
  const permiteLoteNuevo = tipo !== 'salida'   // no se puede sacar de un lote que no existe

  const motivos = tipo === 'entrada' ? MOTIVOS_ENTRADA
    : tipo === 'salida' ? MOTIVOS_SALIDA
    : MOTIVOS_AJUSTE
  const motivoFinal = (motivoSel === OTRO ? motivoOtro : motivoSel).trim()

  const cantidadNum = Number(cantidad)
  const cantidadValida = cantidad.trim() !== '' && Number.isFinite(cantidadNum) && cantidadNum >= 0

  const enSistema = loteElegido?.existencia ?? 0
  const diferencia = cantidadValida ? tresDecimales(cantidadNum - enSistema) : 0

  const existenciaPlaza = producto ? Number(producto.existencia ?? 0) : 0

  // ---- Handlers ---------------------------------------------------------
  const limpiarLote = (nuevoTipo: TipoManual) => {
    setLoteSel(nuevoTipo === 'salida' ? 'fefo' : '')
    setLoteNuevo('')
    setCaducidadNueva('')
    setUbicacionNueva('')
  }

  const cambiarTipo = (t: TipoManual) => {
    setTipo(t)
    setMotivoSel('')
    setMotivoOtro('')
    setCosto('')
    setResultado(null)
    limpiarLote(t)
  }

  const cambiarPlaza = (id: string) => {
    setSucursalId(id)
    setResultado(null)
    limpiarLote(tipo)
  }

  const elegirProducto = (p: ProductoPOS) => {
    setProducto(p)
    setBusqueda('')
    setResultados([])
    setResultado(null)
    limpiarLote(tipo)
  }

  const quitarProducto = () => {
    setProducto(null)
    setLotes([])
    setResultado(null)
    limpiarLote(tipo)
  }

  const tomarFirma = async (nombre: string) => {
    const r = await elegirUsuario(nombre)
    if (r.error) { setResultado({ error: r.error }); return }
    setFirma(nombre)
    setResultado(null)
    startTransition(() => router.refresh())
  }

  const guardar = async () => {
    setResultado(null)

    if (!firma) {
      setResultado({ error: 'Primero dinos quién eres: cada movimiento va firmado (minuta 8).' })
      return
    }
    if (!producto) {
      setResultado({ error: 'Busca y elige el producto que se está moviendo.' })
      return
    }
    if (!sucursalId) {
      setResultado({ error: 'Elige la plaza: el inventario es por plaza.' })
      return
    }
    if (loteSel === '') {
      setResultado({
        error: tipo === 'salida'
          ? 'Elige de qué lote sale, o deja que salga el que caduca primero.'
          : 'Elige a qué lote entra, o captura uno nuevo.',
      })
      return
    }
    if (!cantidadValida) {
      setResultado({
        error: tipo === 'ajuste'
          ? 'Captura cuántas piezas contaste (0 o más).'
          : 'Captura la cantidad de piezas.',
      })
      return
    }
    if (tipo !== 'ajuste' && cantidadNum <= 0) {
      setResultado({ error: 'La cantidad tiene que ser mayor que cero.' })
      return
    }
    if (!motivoFinal) {
      setResultado({ error: 'Di por qué se mueve: es lo que se anotaba en la libreta.' })
      return
    }

    const datos: MovimientoManual = {
      tipo,
      producto_id: producto.producto_id,
      producto_nombre: nombreProducto(producto),
      sucursal_id: sucursalId,
      cantidad: cantidadNum,
      inventario_id: loteElegido?.inventario_id ?? null,
      lote: usaLoteNuevo ? (loteNuevo.trim() || null) : (loteElegido?.lote ?? null),
      caducidad: usaLoteNuevo ? (caducidadNueva || null) : (loteElegido?.caducidad ?? null),
      ubicacion: usaLoteNuevo ? (ubicacionNueva || null) : (loteElegido?.ubicacion ?? null),
      costo_unitario: tipo === 'entrada' && costo.trim() !== '' ? Number(costo) : null,
      motivo: motivoFinal,
      fefo: usaFefo,
    }

    setGuardando(true)
    try {
      const r = await registrarMovimiento(datos)
      setResultado(r)
      if (r.ok) {
        setCantidad('')
        setMotivoSel('')
        setMotivoOtro('')
        setCosto('')
        limpiarLote(tipo)
        // Se recargan los lotes para ver la existencia ya actualizada.
        setRecarga(n => n + 1)
        startTransition(() => router.refresh())
      }
    } finally {
      setGuardando(false)
    }
  }

  // ---- Falta decir quién opera (minuta 8) ------------------------------
  if (!firma) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 mb-6">
        <h2 className="text-lg font-semibold text-amber-900">¿Quién está en el almacén?</h2>
        <p className="text-base text-amber-800 mt-1">
          Cada entrada y salida se firma con tu nombre. Elige el tuyo para poder registrar movimientos.
        </p>
        {usuarios.length === 0 ? (
          <p className="text-base text-amber-800 mt-4">
            No hay nadie dado de alta en <code className="font-mono">usuarios_panel</code>. Agrega al equipo en Supabase para poder firmar.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2 mt-4">
            {usuarios.map(u => (
              <button
                key={u.id}
                type="button"
                onClick={() => tomarFirma(u.nombre)}
                className="px-5 py-2.5 bg-white border border-amber-300 text-base font-medium text-amber-900 rounded-lg hover:bg-amber-100 transition-colors"
              >
                {u.nombre}
              </button>
            ))}
          </div>
        )}
        {resultado?.error && (
          <p className="mt-4 text-base text-red-700">{resultado.error}</p>
        )}
      </div>
    )
  }

  // ---- Panel cerrado ----------------------------------------------------
  if (!abierto) {
    return (
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center gap-3">
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#003366] text-white text-base font-medium rounded-lg hover:bg-[#002244] transition-colors"
        >
          <PlusIcon className="w-5 h-5" />
          Registrar movimiento
        </button>
        <span className="text-base text-gray-500">
          Firmas como <span className="font-medium text-gray-700">{firma}</span>
        </span>
        {resultado?.ok && resultado.mensaje && (
          <span className="inline-flex items-center gap-1.5 text-base text-emerald-700">
            <CheckCircleIcon className="w-5 h-5" />
            {resultado.mensaje}
          </span>
        )}
      </div>
    )
  }

  // ---- Formulario -------------------------------------------------------
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 md:p-6 mb-6">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Registrar movimiento</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Firmas como <span className="font-medium text-gray-700">{firma}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAbierto(false)}
          className="p-2 -m-2 text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="Cerrar"
        >
          <XMarkIcon className="w-6 h-6" />
        </button>
      </div>

      <form
        onSubmit={e => { e.preventDefault(); guardar() }}
        className="space-y-5"
      >
        {/* Tipo */}
        <div className="grid grid-cols-3 gap-3">
          {TIPOS.map(t => (
            <button
              key={t.valor}
              type="button"
              onClick={() => cambiarTipo(t.valor)}
              className={`px-4 py-3 rounded-lg border text-base font-medium transition-colors ${
                tipo === t.valor
                  ? 'bg-[#003366] text-white border-[#003366]'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
              }`}
            >
              <span className="block">{t.label}</span>
              <span className={`block text-xs mt-0.5 ${tipo === t.valor ? 'text-white/70' : 'text-gray-400'}`}>
                {t.ayuda}
              </span>
            </button>
          ))}
        </div>

        {/* Plaza */}
        <div>
          <label className={labelCls}>Plaza</label>
          <select
            value={sucursalId}
            onChange={e => cambiarPlaza(e.target.value)}
            className={selectCls}
          >
            {sucursales.length === 0 && <option value="">Sin plazas dadas de alta</option>}
            {sucursales.map(s => (
              <option key={s.id} value={s.id}>{s.clave} · {s.nombre}</option>
            ))}
          </select>
        </div>

        {/* Producto */}
        <div>
          <label className={labelCls}>Producto</label>
          {producto ? (
            <div className="flex items-start justify-between gap-3 px-4 py-3 border border-gray-200 rounded-lg bg-gray-50/60">
              <div className="min-w-0">
                <div className="font-semibold text-gray-900">{nombreProducto(producto)}</div>
                <div className="text-sm text-gray-500 mt-0.5">
                  {[producto.nombre_generico, producto.concentracion, producto.presentacion, producto.laboratorio]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                <div className="text-sm mt-1">
                  <span className={existenciaPlaza > 0 ? 'text-emerald-700 font-medium' : 'text-red-600 font-medium'}>
                    {piezas(existenciaPlaza)} pza en esta plaza
                  </span>
                  {Number(producto.existencia_otras ?? 0) > 0 && (
                    <span className="text-gray-400"> · {piezas(Number(producto.existencia_otras))} en otras</span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={quitarProducto}
                className="text-sm font-medium text-[#003366] hover:underline whitespace-nowrap"
              >
                Cambiar
              </button>
            </div>
          ) : (
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
                placeholder="Nombre o código de barras..."
                className={inputCls + ' pl-11'}
                autoComplete="off"
              />
              {buscando && (
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-gray-400">
                  Buscando...
                </span>
              )}
              {resultados.length > 0 && (
                <ul className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden max-h-80 overflow-y-auto">
                  {resultados.map(p => (
                    <li key={p.producto_id}>
                      <button
                        type="button"
                        onClick={() => elegirProducto(p)}
                        className="w-full text-left px-4 py-3 hover:bg-[#003366]/5 transition-colors border-b border-gray-50 last:border-0"
                      >
                        <div className="font-medium text-gray-900">{nombreProducto(p)}</div>
                        <div className="text-sm text-gray-500 mt-0.5">
                          {[p.concentracion, p.presentacion, p.laboratorio].filter(Boolean).join(' · ') || '—'}
                        </div>
                        <div className="text-sm mt-0.5">
                          <span className={Number(p.existencia) > 0 ? 'text-emerald-700' : 'text-red-500'}>
                            {piezas(Number(p.existencia ?? 0))} pza aquí
                          </span>
                          {Number(p.existencia_otras ?? 0) > 0 && (
                            <span className="text-gray-400"> · {piezas(Number(p.existencia_otras))} en otras plazas</span>
                          )}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {!buscando && busqueda.trim().length >= 2 && resultados.length === 0 && (
                <p className="text-sm text-gray-400 mt-2">Ningún producto con ese nombre o código.</p>
              )}
            </div>
          )}
        </div>

        {/* Lote (minuta 23) */}
        {producto && (
          <div>
            <label className={labelCls}>
              {tipo === 'salida' ? '¿De qué lote sale?' : tipo === 'entrada' ? '¿A qué lote entra?' : '¿Qué lote contaste?'}
            </label>

            {cargandoLotes && <p className="text-sm text-gray-400 py-2">Cargando lotes...</p>}

            <div className="space-y-2">
              {/* Salida sin elegir lote: sale primero lo que caduca antes */}
              {tipo === 'salida' && (
                <button
                  type="button"
                  onClick={() => setLoteSel('fefo')}
                  className={opcionCls(loteSel === 'fefo')}
                >
                  <span className="font-medium text-gray-900">El que caduca primero</span>
                  <span className="block text-sm text-gray-500 mt-0.5">
                    Reparte la salida entre lotes empezando por el más próximo a vencer.
                  </span>
                </button>
              )}

              {lotes.map(l => (
                <button
                  key={l.inventario_id}
                  type="button"
                  onClick={() => setLoteSel(l.inventario_id)}
                  className={opcionCls(loteSel === l.inventario_id)}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="font-mono font-medium text-gray-900">{l.lote || 'Sin lote'}</span>
                      <span className="block text-sm text-gray-500 mt-0.5">
                        {l.caducidad ? `Caduca ${formatDia(l.caducidad)}` : 'Sin caducidad'}
                        {l.ubicacion && ` · ${l.ubicacion}`}
                      </span>
                    </span>
                    <span className="text-lg font-semibold text-gray-900 whitespace-nowrap">
                      {piezas(l.existencia)} pza
                    </span>
                  </span>
                </button>
              ))}

              {!cargandoLotes && lotes.length === 0 && (
                <p className="text-sm text-gray-500 py-1">
                  {tipo === 'salida'
                    ? 'Este producto no tiene existencia en esta plaza.'
                    : 'Este producto todavía no tiene lotes con existencia en esta plaza.'}
                </p>
              )}

              {/* Lote nuevo: mercancía que llega por primera vez */}
              {permiteLoteNuevo && (
                <button
                  type="button"
                  onClick={() => setLoteSel('nuevo')}
                  className={opcionCls(usaLoteNuevo)}
                >
                  <span className="font-medium text-gray-900">+ Lote nuevo</span>
                  <span className="block text-sm text-gray-500 mt-0.5">
                    Captura el número de lote y su caducidad.
                  </span>
                </button>
              )}
            </div>

            {usaLoteNuevo && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3 p-4 bg-gray-50/60 border border-gray-200 rounded-lg">
                <div>
                  <label className={labelCls}>Lote</label>
                  <input
                    value={loteNuevo}
                    onChange={e => setLoteNuevo(e.target.value)}
                    placeholder="Ej. 13250125"
                    className={inputCls}
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className={labelCls}>Caducidad</label>
                  <input
                    type="date"
                    value={caducidadNueva}
                    onChange={e => setCaducidadNueva(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Ubicación</label>
                  <select
                    value={ubicacionNueva}
                    onChange={e => setUbicacionNueva(e.target.value)}
                    className={selectCls}
                  >
                    <option value="">Sin ubicación</option>
                    {UBICACIONES.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Cantidad, motivo y costo */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className={labelCls}>
              {tipo === 'ajuste' ? 'Existencia REAL contada' : 'Cantidad (piezas)'}
            </label>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={cantidad}
              onChange={e => setCantidad(e.target.value)}
              placeholder="0"
              className={inputCls}
            />
            {tipo === 'ajuste' && loteSel !== '' && cantidadValida && (
              <p className="text-sm mt-1.5">
                {diferencia === 0 ? (
                  <span className="text-gray-500">
                    El sistema ya tiene {piezas(enSistema)} pza: no hay nada que ajustar.
                  </span>
                ) : (
                  <span className={diferencia > 0 ? 'text-emerald-600' : 'text-orange-600'}>
                    Sistema {piezas(enSistema)} → contado {piezas(cantidadNum)} ·
                    se registra {diferencia > 0 ? '+' : '−'}{piezas(Math.abs(diferencia))} pza
                  </span>
                )}
              </p>
            )}
            {tipo === 'salida' && loteElegido && cantidadValida && cantidadNum > loteElegido.existencia && (
              <p className="text-sm text-red-600 mt-1.5">
                Ese lote sólo tiene {piezas(loteElegido.existencia)} pza.
              </p>
            )}
          </div>

          <div>
            <label className={labelCls}>Motivo</label>
            <select
              value={motivoSel}
              onChange={e => setMotivoSel(e.target.value)}
              className={selectCls}
            >
              <option value="">Elegir motivo...</option>
              {motivos.map(m => <option key={m} value={m}>{m}</option>)}
              <option value={OTRO}>Otro (escribirlo)</option>
            </select>
            {motivoSel === OTRO && (
              <input
                value={motivoOtro}
                onChange={e => setMotivoOtro(e.target.value)}
                placeholder="¿Por qué se mueve?"
                className={inputCls + ' mt-3'}
                autoComplete="off"
              />
            )}
          </div>

          {tipo === 'entrada' && (
            <div>
              <label className={labelCls}>Costo unitario (opcional)</label>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={costo}
                onChange={e => setCosto(e.target.value)}
                placeholder="0.00"
                className={inputCls}
              />
            </div>
          )}
        </div>

        {/* El mensaje del RPC se muestra tal cual: ya viene en español. */}
        {resultado?.error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-base">
            {resultado.error}
          </div>
        )}
        {resultado?.aviso && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 text-base">
            {resultado.aviso}
          </div>
        )}
        {resultado?.ok && resultado.mensaje && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-4 text-base flex items-start gap-2">
            <CheckCircleIcon className="w-5 h-5 shrink-0 mt-0.5" />
            {resultado.mensaje}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 pt-1">
          <button
            type="submit"
            disabled={ocupado}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-[#003366] text-white text-base font-medium rounded-lg hover:bg-[#002244] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {ocupado ? 'Guardando...' : 'Guardar movimiento'}
          </button>
          <button
            type="button"
            onClick={() => setAbierto(false)}
            className="px-5 py-3 text-base font-medium text-gray-500 hover:text-gray-700 transition-colors"
          >
            Cerrar
          </button>
        </div>
      </form>
    </div>
  )
}
