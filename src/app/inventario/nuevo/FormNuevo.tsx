'use client'

// Alta rápida de un medicamento (punto 1 del cliente).
//
// El orden de la pantalla es el orden en que se hace el trabajo en el
// mostrador: **primero se escanea la caja**. Por eso el foco entra en el
// código de barras y, en cuanto se captura, se pregunta si ese código ya es de
// alguien. El catálogo llegó con 147 duplicados; el modo de no hacer el 148 es
// preguntar antes, no después.
//
// Después van los cuatro campos que pidió el cliente (minuta 17): nombre
// comercial, genérico, miligramos y presentación. El IVA arranca en 0% porque
// casi todo lo que venden es medicamento de uso humano (minuta 3).
//
// La existencia inicial es opcional y va en el mismo formulario: si se llena,
// el servidor la mete con `registrar_movimiento` tipo 'entrada'. Si se deja
// vacía no se registra nada y el producto queda en el catálogo, sin piezas.

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowPathIcon, ArrowTopRightOnSquareIcon, CheckCircleIcon,
  ExclamationTriangleIcon, PlusIcon, QrCodeIcon,
} from '@heroicons/react/20/solid'
import { MOTIVOS_ENTRADA, UBICACIONES } from '@/lib/constantes'
import {
  buscarPorCodigo, crearProducto,
  type DatosProducto, type EntradaLote, type ProductoConCodigo, type Resultado,
} from '../acciones'

interface PlazaOpcion {
  id: string
  clave: string
  nombre: string
}

export interface Sugerencias {
  laboratorios: string[]
  categorias: string[]
  formas: string[]
  presentaciones: string[]
}

interface Props {
  sucursales: PlazaOpcion[]
  sucursalInicial: string
  /** Quién firma el movimiento. null = todavía no se ha elegido en el header. */
  usuario: string | null
  sugerencias: Sugerencias
}

const inputCls =
  'w-full px-4 py-3 text-base border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366]'
const selectCls = inputCls + ' bg-white'
const labelCls = 'block text-sm font-medium text-gray-600 mb-1.5'
const cardCls = 'bg-white border border-gray-200 rounded-xl p-6'

// Un EAN/GTIN trae de 8 a 14 dígitos. Lo que no cumpla eso suele ser la clave
// interna de Aspel; se deja guardar, pero se avisa, porque la pistola del POS
// no lo va a encontrar.
const pareceCodigoBarras = (s: string) => /^\d{8,14}$/.test(s)

const VACIO = {
  codigo: '',
  comercial: '',
  generico: '',
  concentracion: '',
  presentacion: '',
  forma: '',
  laboratorio: '',
  categoria: '',
  precio: '',
  controlado: false,
}

export default function FormNuevo({ sucursales, sucursalInicial, usuario, sugerencias }: Props) {
  const router = useRouter()
  const campoCodigo = useRef<HTMLInputElement>(null)
  const campoComercial = useRef<HTMLInputElement>(null)

  // ---- Datos del producto ----------------------------------------------
  const [f, setF] = useState({ ...VACIO })
  const set = (cambios: Partial<typeof VACIO>) => setF(v => ({ ...v, ...cambios }))
  const [tasaIva, setTasaIva] = useState(0)   // 0% por defecto (minuta 3)

  // ---- Existencia inicial (opcional) ------------------------------------
  const [sucursalId, setSucursalId] = useState(sucursalInicial)
  const [lote, setLote] = useState('')
  const [caducidad, setCaducidad] = useState('')
  const [ubicacion, setUbicacion] = useState('')
  const [piezas, setPiezas] = useState('')
  const [costo, setCosto] = useState('')
  const [motivo, setMotivo] = useState('Alta de producto')

  // ---- Código de barras: ¿ya existe? ------------------------------------
  const [duplicado, setDuplicado] = useState<ProductoConCodigo | null>(null)
  const [revisando, setRevisando] = useState(false)

  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [pendiente, startTransition] = useTransition()
  const [guardando, setGuardando] = useState(false)
  const ocupado = guardando || pendiente

  // El foco entra en el código: se escanea la caja antes de escribir nada.
  useEffect(() => { campoCodigo.current?.focus() }, [])

  // Se consulta con un respiro para no pegarle a la base en cada tecla; la
  // pistola escribe el código de golpe, así que en la práctica es una sola
  // consulta por caja escaneada.
  useEffect(() => {
    const c = f.codigo.trim()
    if (!c) {
      setDuplicado(null)
      setRevisando(false)
      return
    }
    let vivo = true
    setRevisando(true)
    const t = setTimeout(async () => {
      const r = await buscarPorCodigo(c)
      if (!vivo) return
      setRevisando(false)
      setDuplicado(r.producto)
      if (r.error) setResultado({ error: r.error })
    }, 350)
    return () => { vivo = false; clearTimeout(t) }
  }, [f.codigo])

  // ---- Nombre con el que queda en el catálogo ---------------------------
  // Es el renglón que ve el POS y con el que busca el equipo. Se arma con los
  // campos de la minuta 17 y se enseña antes de guardar para que nadie se
  // lleve una sorpresa.
  const nombreCatalogo = [
    f.comercial.trim(),
    f.generico.trim() && f.generico.trim() !== f.comercial.trim() ? f.generico.trim() : '',
    f.forma.trim(),
    f.concentracion.trim(),
    f.presentacion.trim(),
  ].filter(Boolean).join(' ')

  const hayNombre = !!(f.comercial.trim() || f.generico.trim())
  const piezasNum = Number(piezas)
  const conEntrada = piezas.trim() !== '' && Number.isFinite(piezasNum) && piezasNum > 0
  const faltaFirma = conEntrada && !usuario

  const limpiar = (s: string) => (s.trim() === '' ? null : s.trim())
  const aNumero = (s: string) => {
    const n = Number(s)
    return s.trim() === '' || !Number.isFinite(n) ? null : n
  }

  const reiniciar = () => {
    setF({ ...VACIO })
    setTasaIva(0)
    setLote('')
    setCaducidad('')
    setPiezas('')
    setCosto('')
    setDuplicado(null)
    // La plaza, la ubicación y el motivo se conservan: capturando en serie son
    // los mismos en toda la tanda.
    setTimeout(() => campoCodigo.current?.focus(), 0)
  }

  const guardar = (otro: boolean) => {
    if (ocupado) return
    if (!hayNombre) {
      setResultado({ error: 'Escribe al menos el nombre comercial o el genérico del producto.' })
      campoComercial.current?.focus()
      return
    }
    if (duplicado) {
      setResultado({
        error: `El código ${f.codigo.trim()} ya lo tiene "${duplicado.nombre}". Abre ese producto en vez de crear un duplicado.`,
        duplicado,
      })
      return
    }

    const datos: DatosProducto = {
      nombre: nombreCatalogo || null,
      codigo_barras: limpiar(f.codigo),
      nombre_comercial: limpiar(f.comercial),
      nombre_generico: limpiar(f.generico),
      concentracion: limpiar(f.concentracion),
      presentacion: limpiar(f.presentacion),
      forma_farmaceutica: limpiar(f.forma),
      laboratorio: limpiar(f.laboratorio),
      categoria: limpiar(f.categoria),
      precio_base: aNumero(f.precio),
      tasa_iva: tasaIva,
      controlado: f.controlado,
      stock_minimo: null,
    }

    const inicial: EntradaLote | null = conEntrada
      ? {
          sucursal_id: sucursalId,
          lote: limpiar(lote),
          caducidad: limpiar(caducidad),
          ubicacion: limpiar(ubicacion),
          piezas: piezasNum,
          costo_unitario: aNumero(costo),
          motivo: limpiar(motivo),
        }
      : null

    setGuardando(true)
    setResultado(null)
    startTransition(async () => {
      const r = await crearProducto(datos, inicial)
      setGuardando(false)
      setResultado(r)
      if (!r.ok) return
      if (otro) {
        reiniciar()
        router.refresh()
      } else if (r.producto_id) {
        // A la ficha del producto recién creado: ahí se le agregan más lotes.
        router.push(`/inventario/${r.producto_id}`)
      }
    })
  }

  const botonIva = (activo: boolean) =>
    `flex-1 px-4 py-3 rounded-lg border text-base font-medium transition-colors ${
      activo
        ? 'border-[#003366] bg-[#003366]/5 text-[#003366] ring-1 ring-[#003366]/30'
        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
    }`

  return (
    <div className="max-w-5xl">
      {/* ---- Avisos ------------------------------------------------------ */}
      {resultado?.error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-6 text-base">
          {resultado.error}
          {resultado.duplicado && (
            <Link
              href={`/inventario/${resultado.duplicado.id}`}
              className="mt-3 inline-flex items-center gap-1.5 text-base font-medium text-[#003366] hover:underline"
            >
              Abrir "{resultado.duplicado.nombre}"
              <ArrowTopRightOnSquareIcon className="w-4 h-4" />
            </Link>
          )}
        </div>
      )}
      {resultado?.aviso && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 mb-6 text-base">
          {resultado.aviso}
        </div>
      )}
      {resultado?.ok && resultado.mensaje && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-4 mb-6 text-base flex items-start gap-2">
          <CheckCircleIcon className="w-5 h-5 mt-0.5 shrink-0" />
          <span>{resultado.mensaje}</span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        {/* ---- Datos del producto --------------------------------------- */}
        <div className={cardCls + ' space-y-5'}>
          <div>
            <label className={labelCls}>
              <span className="inline-flex items-center gap-1.5">
                <QrCodeIcon className="w-4 h-4 text-gray-400" />
                Código de barras · escanea la caja
              </span>
            </label>
            <input
              ref={campoCodigo}
              value={f.codigo}
              onChange={e => set({ codigo: e.target.value })}
              onKeyDown={e => {
                // La pistola manda Enter al terminar. Sin esto, ese Enter
                // enviaría el formulario a medias.
                if (e.key === 'Enter') {
                  e.preventDefault()
                  campoComercial.current?.focus()
                }
              }}
              inputMode="numeric"
              autoComplete="off"
              placeholder="7501234567890"
              className={inputCls + ' font-mono'}
            />
            <div className="mt-2 min-h-[1.25rem] text-sm">
              {revisando && <span className="text-gray-400">Revisando el catálogo…</span>}
              {!revisando && !duplicado && f.codigo.trim() !== '' && (
                pareceCodigoBarras(f.codigo.trim())
                  ? <span className="text-emerald-700">Código libre.</span>
                  : <span className="text-amber-700">
                      No parece un código de barras (van de 8 a 14 dígitos). Se puede guardar, pero la pistola del punto de venta no lo va a encontrar.
                    </span>
              )}
            </div>

            {duplicado && (
              <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg p-4">
                <div className="flex items-start gap-2 text-amber-900 text-base">
                  <ExclamationTriangleIcon className="w-5 h-5 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium">Ese código ya es de otro producto.</p>
                    <p className="mt-0.5">
                      {duplicado.nombre}
                      {' · '}{duplicado.existencia} pza en inventario
                      {!duplicado.activo && ' · desactivado'}
                    </p>
                    <p className="mt-1 text-sm">
                      No lo des de alta otra vez: ábrelo y corrige ahí lo que falte.
                    </p>
                    <Link
                      href={`/inventario/${duplicado.id}`}
                      className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-[#003366] text-white text-base font-medium rounded-lg hover:bg-[#002244] transition-colors"
                    >
                      Ir a ese producto
                      <ArrowTopRightOnSquareIcon className="w-4 h-4" />
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-gray-100 pt-5 space-y-5">
            <div>
              <label className={labelCls}>Nombre comercial *</label>
              <input
                ref={campoComercial}
                value={f.comercial}
                onChange={e => set({ comercial: e.target.value })}
                placeholder="Ej. TAFIL"
                autoComplete="off"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Nombre genérico</label>
              <input
                value={f.generico}
                onChange={e => set({ generico: e.target.value })}
                placeholder="Ej. ALPRAZOLAM"
                autoComplete="off"
                className={inputCls}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Miligramos</label>
                <input
                  value={f.concentracion}
                  onChange={e => set({ concentracion: e.target.value })}
                  placeholder="Ej. 500 mg"
                  autoComplete="off"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Presentación</label>
                <input
                  value={f.presentacion}
                  onChange={e => set({ presentacion: e.target.value })}
                  list="sug-presentaciones"
                  placeholder="Ej. C/30"
                  autoComplete="off"
                  className={inputCls}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Forma farmacéutica</label>
                <input
                  value={f.forma}
                  onChange={e => set({ forma: e.target.value })}
                  list="sug-formas"
                  placeholder="Ej. TAB"
                  autoComplete="off"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Laboratorio</label>
                <input
                  value={f.laboratorio}
                  onChange={e => set({ laboratorio: e.target.value })}
                  list="sug-laboratorios"
                  placeholder="Ej. PFIZER"
                  autoComplete="off"
                  className={inputCls}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Categoría</label>
                <input
                  value={f.categoria}
                  onChange={e => set({ categoria: e.target.value })}
                  list="sug-categorias"
                  placeholder="Ej. Oncológico"
                  autoComplete="off"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Precio de venta</label>
                <input
                  value={f.precio}
                  onChange={e => set({ precio: e.target.value })}
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  className={inputCls}
                />
              </div>
            </div>

            <datalist id="sug-laboratorios">
              {sugerencias.laboratorios.map(v => <option key={v} value={v} />)}
            </datalist>
            <datalist id="sug-categorias">
              {sugerencias.categorias.map(v => <option key={v} value={v} />)}
            </datalist>
            <datalist id="sug-formas">
              {sugerencias.formas.map(v => <option key={v} value={v} />)}
            </datalist>
            <datalist id="sug-presentaciones">
              {sugerencias.presentaciones.map(v => <option key={v} value={v} />)}
            </datalist>
          </div>

          {/* ---- IVA ---------------------------------------------------- */}
          <div className="border-t border-gray-100 pt-5">
            <label className={labelCls}>IVA</label>
            <div className="flex gap-3">
              <button type="button" onClick={() => setTasaIva(0)} className={botonIva(tasaIva === 0)}>
                0%
                <span className="block text-sm font-normal text-gray-500 mt-0.5">
                  Medicamento de uso humano
                </span>
              </button>
              <button type="button" onClick={() => setTasaIva(0.16)} className={botonIva(tasaIva === 0.16)}>
                16%
                <span className="block text-sm font-normal text-gray-500 mt-0.5">
                  Material de curación y otros
                </span>
              </button>
            </div>
            <label className="mt-4 flex items-center gap-2.5 text-base text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={f.controlado}
                onChange={e => set({ controlado: e.target.checked })}
                className="w-5 h-5 rounded border-gray-300 text-[#003366] focus:ring-[#003366]/30"
              />
              Es medicamento controlado
            </label>
          </div>
        </div>

        {/* ---- Existencia inicial --------------------------------------- */}
        <div className="space-y-6">
          <div className={cardCls + ' space-y-5'}>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Existencia inicial</h2>
              <p className="text-sm text-gray-500 mt-1">
                Opcional. Si capturas piezas, se registra como entrada en el kardex con el motivo
                "Alta de producto". Si lo dejas vacío, el producto queda en el catálogo sin piezas.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Plaza</label>
                <select value={sucursalId} onChange={e => setSucursalId(e.target.value)} className={selectCls}>
                  {sucursales.map(s => (
                    <option key={s.id} value={s.id}>{s.clave} · {s.nombre}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Piezas</label>
                <input
                  value={piezas}
                  onChange={e => setPiezas(e.target.value)}
                  type="number"
                  min="0"
                  step="1"
                  placeholder="0"
                  className={inputCls}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Lote</label>
                <input
                  value={lote}
                  onChange={e => setLote(e.target.value)}
                  placeholder="Ej. 13250125"
                  autoComplete="off"
                  className={inputCls + ' font-mono'}
                />
              </div>
              <div>
                <label className={labelCls}>Caducidad</label>
                <input
                  value={caducidad}
                  onChange={e => setCaducidad(e.target.value)}
                  type="date"
                  className={inputCls}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Ubicación</label>
                <select value={ubicacion} onChange={e => setUbicacion(e.target.value)} className={selectCls}>
                  <option value="">Sin ubicación</option>
                  {UBICACIONES.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Costo por pieza</label>
                <input
                  value={costo}
                  onChange={e => setCosto(e.target.value)}
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  className={inputCls}
                />
              </div>
            </div>

            <div>
              <label className={labelCls}>Motivo del movimiento</label>
              <select value={motivo} onChange={e => setMotivo(e.target.value)} className={selectCls}>
                <option value="Alta de producto">Alta de producto</option>
                {MOTIVOS_ENTRADA.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>

            {faltaFirma && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-4 text-base">
                Para meter piezas al inventario hay que decir quién lo hace: elige tu nombre arriba,
                en la barra del panel. Sin eso sólo se puede dar de alta el producto, sin existencia.
              </div>
            )}
          </div>

          {/* ---- Cómo va a quedar en el catálogo ------------------------- */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-5">
            <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
              Así queda en el catálogo
            </p>
            <p className="mt-2 text-base text-gray-900 font-medium break-words">
              {nombreCatalogo || <span className="text-gray-400 font-normal">Escribe el nombre comercial…</span>}
            </p>
            <p className="mt-1 text-sm text-gray-500">
              IVA {tasaIva === 0 ? '0%' : '16%'}
              {f.controlado && ' · controlado'}
              {conEntrada && ` · entra con ${piezasNum} pza`}
            </p>
          </div>
        </div>
      </div>

      {/* ---- Guardar ----------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-3 mt-6">
        <button
          type="button"
          onClick={() => guardar(false)}
          disabled={ocupado || !hayNombre || !!duplicado}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#003366] text-white text-base font-medium rounded-lg hover:bg-[#002244] transition-colors disabled:opacity-40"
        >
          {ocupado ? <ArrowPathIcon className="w-5 h-5 animate-spin" /> : <PlusIcon className="w-5 h-5" />}
          Guardar producto
        </button>
        <button
          type="button"
          onClick={() => guardar(true)}
          disabled={ocupado || !hayNombre || !!duplicado}
          className="inline-flex items-center gap-2 px-5 py-2.5 border border-gray-300 text-gray-700 text-base font-medium rounded-lg hover:bg-white transition-colors disabled:opacity-40"
        >
          Guardar y dar de alta otro
        </button>
        <Link
          href="/inventario"
          className="px-5 py-2.5 text-base font-medium text-gray-500 hover:text-gray-700 transition-colors"
        >
          Cancelar
        </Link>
      </div>
    </div>
  )
}
