'use client'

// Edición ágil de un producto (punto 4 del cliente).
//
//   "Facilitar la edición de productos para modificar información, subir
//    contenido y ajustar cantidades de forma rápida."
//
// Todo pasa en esta pantalla, sin navegar: los datos del catálogo, el conteo
// de cada lote y la entrada de un lote nuevo.
//
// Lo importante: **las cantidades no se editan, se ajustan**. El operador
// captura lo que CONTÓ en el anaquel y el servidor calcula la diferencia y la
// registra como movimiento de tipo 'ajuste'. Así queda el asiento en el kardex
// con quién, cuándo y por qué (minuta 8, 10, 23). Un update directo sobre
// `inventario` movería piezas sin dejar rastro, y es justo lo que hoy no
// cuadra en la libreta.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowPathIcon, ArrowTopRightOnSquareIcon, CheckCircleIcon,
  ExclamationTriangleIcon, EyeSlashIcon, EyeIcon, PlusIcon, QrCodeIcon,
} from '@heroicons/react/20/solid'
import { MOTIVOS_ENTRADA, UBICACIONES } from '@/lib/constantes'
import { formatDia, pesos } from '@/lib/utils'
import {
  actualizarProducto, agregarLote, ajustarLote, cambiarActivo,
  type DatosProducto, type EntradaLote, type Resultado,
} from '../acciones'

// ------------------------------------------------------------------ tipos --

export interface ProductoFila {
  id: string
  nombre: string | null
  nombre_comercial: string | null
  nombre_generico: string | null
  concentracion: string | null
  forma_farmaceutica: string | null
  presentacion: string | null
  laboratorio: string | null
  categoria: string | null
  codigo_barras: string | null
  precio_base: number | null
  tasa_iva: number | null
  controlado: boolean | null
  activo: boolean | null
  stock_minimo: number | null
}

export interface LoteFila {
  id: string
  lote: string | null
  caducidad: string | null
  ubicacion: string | null
  existencia: number | null
  costo_unitario: number | null
  sucursal_id: string | null
  sucursal_clave: string | null
  sucursal_nombre: string | null
}

export interface PlazaOpcion {
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
  producto: ProductoFila
  lotes: LoteFila[]
  sucursales: PlazaOpcion[]
  sucursalInicial: string
  /** Quién firma los movimientos. null = todavía no se ha elegido. */
  usuario: string | null
  sugerencias: Sugerencias
}

// ----------------------------------------------------------------- estilo --

const inputCls =
  'w-full px-4 py-3 text-base border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366]'
const selectCls = inputCls + ' bg-white'
const labelCls = 'block text-sm font-medium text-gray-600 mb-1.5'
const cardCls = 'bg-white border border-gray-200 rounded-xl'
const thCls = 'text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide'
const btnPrimario =
  'inline-flex items-center gap-2 px-5 py-2.5 bg-[#003366] text-white text-base font-medium rounded-lg hover:bg-[#002244] transition-colors disabled:opacity-40'
const btnSecundario =
  'inline-flex items-center gap-2 px-5 py-2.5 border border-gray-300 text-gray-700 text-base font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-40'

const tresDecimales = (n: number) => Math.round(n * 1000) / 1000
const piezas = (n: number | null | undefined) => {
  const v = Number(n ?? 0)
  return Number.isInteger(v) ? v.toLocaleString('es-MX') : v.toLocaleString('es-MX', { maximumFractionDigits: 3 })
}

// ---------------------------------------------------------------- pantalla -

export default function EditarProducto({
  producto, lotes, sucursales, sucursalInicial, usuario, sugerencias,
}: Props) {
  const router = useRouter()

  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [pendiente, startTransition] = useTransition()
  const [ocupado, setOcupado] = useState(false)
  const trabajando = ocupado || pendiente

  const correr = (fn: () => Promise<Resultado>, alTerminar?: () => void) => {
    if (trabajando) return
    setOcupado(true)
    setResultado(null)
    startTransition(async () => {
      const r = await fn()
      setOcupado(false)
      setResultado(r)
      if (r.ok) {
        alTerminar?.()
        router.refresh()
      }
    })
  }

  // ---- Datos del catálogo ------------------------------------------------
  const [d, setD] = useState({
    nombre: producto.nombre ?? '',
    codigo: producto.codigo_barras ?? '',
    comercial: producto.nombre_comercial ?? '',
    generico: producto.nombre_generico ?? '',
    concentracion: producto.concentracion ?? '',
    presentacion: producto.presentacion ?? '',
    forma: producto.forma_farmaceutica ?? '',
    laboratorio: producto.laboratorio ?? '',
    categoria: producto.categoria ?? '',
    precio: producto.precio_base == null ? '' : String(producto.precio_base),
    minimo: producto.stock_minimo == null ? '' : String(producto.stock_minimo),
    controlado: !!producto.controlado,
  })
  const set = (cambios: Partial<typeof d>) => setD(v => ({ ...v, ...cambios }))
  const [tasaIva, setTasaIva] = useState(Number(producto.tasa_iva ?? 0) === 0.16 ? 0.16 : 0)

  const limpiar = (s: string) => (s.trim() === '' ? null : s.trim())
  const aNumero = (s: string) => {
    const n = Number(s)
    return s.trim() === '' || !Number.isFinite(n) ? null : n
  }

  const datos = (): DatosProducto => ({
    nombre: limpiar(d.nombre),
    codigo_barras: limpiar(d.codigo),
    nombre_comercial: limpiar(d.comercial),
    nombre_generico: limpiar(d.generico),
    concentracion: limpiar(d.concentracion),
    presentacion: limpiar(d.presentacion),
    forma_farmaceutica: limpiar(d.forma),
    laboratorio: limpiar(d.laboratorio),
    categoria: limpiar(d.categoria),
    precio_base: aNumero(d.precio),
    tasa_iva: tasaIva,
    controlado: d.controlado,
    stock_minimo: aNumero(d.minimo),
  })

  const guardarDatos = (reasignarCodigo = false) =>
    correr(() => actualizarProducto(producto.id, datos(), reasignarCodigo))

  // ---- Conteo por lote ---------------------------------------------------
  const [contados, setContados] = useState<Record<string, string>>({})
  const [motivoAjuste, setMotivoAjuste] = useState('Ajuste por conteo físico')

  const diferenciaDe = (l: LoteFila): number | null => {
    const texto = contados[l.id]
    if (texto === undefined || texto.trim() === '') return null
    const n = Number(texto)
    if (!Number.isFinite(n) || n < 0) return null
    return tresDecimales(n - Number(l.existencia ?? 0))
  }

  const ajustar = (l: LoteFila) => {
    const n = Number(contados[l.id])
    correr(
      () => ajustarLote(l.id, n, motivoAjuste),
      () => setContados(c => ({ ...c, [l.id]: '' })),
    )
  }

  // ---- Lote nuevo --------------------------------------------------------
  const [abriendoLote, setAbriendoLote] = useState(false)
  const [nuevo, setNuevo] = useState({
    sucursal_id: sucursalInicial,
    lote: '',
    caducidad: '',
    ubicacion: '',
    piezas: '',
    costo: '',
    motivo: MOTIVOS_ENTRADA[0],
  })
  const setNuevoCampo = (cambios: Partial<typeof nuevo>) => setNuevo(v => ({ ...v, ...cambios }))

  const guardarLote = () => {
    const entrada: EntradaLote = {
      sucursal_id: nuevo.sucursal_id,
      lote: limpiar(nuevo.lote),
      caducidad: limpiar(nuevo.caducidad),
      ubicacion: limpiar(nuevo.ubicacion),
      piezas: Number(nuevo.piezas),
      costo_unitario: aNumero(nuevo.costo),
      motivo: nuevo.motivo,
    }
    correr(
      () => agregarLote(producto.id, entrada),
      () => {
        setNuevo(v => ({ ...v, lote: '', caducidad: '', piezas: '', costo: '' }))
        setAbriendoLote(false)
      },
    )
  }

  // ---- Totales -----------------------------------------------------------
  const totalPiezas = lotes.reduce((s, l) => s + Number(l.existencia ?? 0), 0)
  const activo = producto.activo !== false

  const botonIva = (act: boolean) =>
    `flex-1 px-4 py-3 rounded-lg border text-base font-medium transition-colors ${
      act
        ? 'border-[#003366] bg-[#003366]/5 text-[#003366] ring-1 ring-[#003366]/30'
        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
    }`

  return (
    <div className="space-y-6">
      {/* ---- Avisos ------------------------------------------------------ */}
      {resultado?.error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-base">
          {resultado.error}
          {resultado.duplicado && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Link
                href={`/inventario/${resultado.duplicado.id}`}
                className="inline-flex items-center gap-1.5 text-base font-medium text-[#003366] hover:underline"
              >
                Abrir "{resultado.duplicado.nombre}" ({piezas(resultado.duplicado.existencia)} pza)
                <ArrowTopRightOnSquareIcon className="w-4 h-4" />
              </Link>
              <button type="button" onClick={() => guardarDatos(true)} disabled={trabajando} className={btnSecundario}>
                Reasignar el código a este producto
              </button>
            </div>
          )}
        </div>
      )}
      {resultado?.aviso && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 text-base">
          {resultado.aviso}
        </div>
      )}
      {resultado?.ok && resultado.mensaje && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-4 text-base flex items-start gap-2">
          <CheckCircleIcon className="w-5 h-5 mt-0.5 shrink-0" />
          <span>{resultado.mensaje}</span>
        </div>
      )}
      {!usuario && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 text-base">
          Para ajustar cantidades o meter un lote hay que decir quién lo hace: elige tu nombre
          arriba, en la barra del panel. Los datos del catálogo sí se pueden editar sin eso.
        </div>
      )}

      {/* ---- Datos del catálogo ------------------------------------------ */}
      <div className={cardCls + ' p-6'}>
        <h2 className="text-base font-semibold text-gray-900 mb-5">Datos del producto</h2>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <div>
            <label className={labelCls}>
              <span className="inline-flex items-center gap-1.5">
                <QrCodeIcon className="w-4 h-4 text-gray-400" />
                Código de barras
              </span>
            </label>
            <input
              value={d.codigo}
              onChange={e => set({ codigo: e.target.value })}
              inputMode="numeric"
              autoComplete="off"
              placeholder="Sin código: la pistola no lo encuentra"
              className={inputCls + ' font-mono'}
            />
          </div>
          <div>
            <label className={labelCls}>Nombre en el catálogo</label>
            <input
              value={d.nombre}
              onChange={e => set({ nombre: e.target.value })}
              autoComplete="off"
              className={inputCls}
            />
            <p className="mt-1.5 text-sm text-gray-400">
              Es el renglón con el que lo busca el punto de venta.
            </p>
          </div>
          <div>
            <label className={labelCls}>Nombre comercial *</label>
            <input
              value={d.comercial}
              onChange={e => set({ comercial: e.target.value })}
              autoComplete="off"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Nombre genérico</label>
            <input
              value={d.generico}
              onChange={e => set({ generico: e.target.value })}
              autoComplete="off"
              className={inputCls}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Miligramos</label>
              <input
                value={d.concentracion}
                onChange={e => set({ concentracion: e.target.value })}
                autoComplete="off"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Presentación</label>
              <input
                value={d.presentacion}
                onChange={e => set({ presentacion: e.target.value })}
                list="sug-presentaciones"
                autoComplete="off"
                className={inputCls}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Forma farmacéutica</label>
              <input
                value={d.forma}
                onChange={e => set({ forma: e.target.value })}
                list="sug-formas"
                autoComplete="off"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Laboratorio</label>
              <input
                value={d.laboratorio}
                onChange={e => set({ laboratorio: e.target.value })}
                list="sug-laboratorios"
                autoComplete="off"
                className={inputCls}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Categoría</label>
              <input
                value={d.categoria}
                onChange={e => set({ categoria: e.target.value })}
                list="sug-categorias"
                autoComplete="off"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Precio de venta</label>
              <input
                value={d.precio}
                onChange={e => set({ precio: e.target.value })}
                type="number" min="0" step="0.01"
                className={inputCls}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Mínimo antes de alertar</label>
              <input
                value={d.minimo}
                onChange={e => set({ minimo: e.target.value })}
                type="number" min="0" step="1"
                placeholder="0"
                className={inputCls}
              />
            </div>
            <div className="flex items-end pb-3">
              <label className="flex items-center gap-2.5 text-base text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={d.controlado}
                  onChange={e => set({ controlado: e.target.checked })}
                  className="w-5 h-5 rounded border-gray-300 text-[#003366] focus:ring-[#003366]/30"
                />
                Medicamento controlado
              </label>
            </div>
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

        <div className="mt-5 pt-5 border-t border-gray-100">
          <label className={labelCls}>IVA</label>
          <div className="flex gap-3 max-w-xl">
            <button type="button" onClick={() => setTasaIva(0)} className={botonIva(tasaIva === 0)}>
              0%
              <span className="block text-sm font-normal text-gray-500 mt-0.5">Medicamento de uso humano</span>
            </button>
            <button type="button" onClick={() => setTasaIva(0.16)} className={botonIva(tasaIva === 0.16)}>
              16%
              <span className="block text-sm font-normal text-gray-500 mt-0.5">Material de curación y otros</span>
            </button>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => guardarDatos()} disabled={trabajando} className={btnPrimario}>
            {trabajando ? <ArrowPathIcon className="w-5 h-5 animate-spin" /> : <CheckCircleIcon className="w-5 h-5" />}
            Guardar cambios
          </button>
          <button
            type="button"
            onClick={() => correr(() => cambiarActivo(producto.id, !activo))}
            disabled={trabajando}
            className={btnSecundario + (activo ? ' text-red-600 border-red-200 hover:bg-red-50' : '')}
          >
            {activo ? <EyeSlashIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
            {activo ? 'Desactivar producto' : 'Reactivar producto'}
          </button>
          <span className="text-sm text-gray-400">
            Desactivar lo saca del mostrador sin borrar su historial.
          </span>
        </div>
      </div>

      {/* ---- Lotes y conteo ---------------------------------------------- */}
      <div className={cardCls + ' overflow-hidden'}>
        <div className="px-6 py-5 border-b border-gray-100 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Cantidades por lote</h2>
            <p className="text-sm text-gray-500 mt-1">
              Captura lo que CONTASTE en el anaquel. El sistema saca la diferencia y la deja
              asentada en el kardex; si cuadra, no registra nada.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-600">Motivo</label>
            <select
              value={motivoAjuste}
              onChange={e => setMotivoAjuste(e.target.value)}
              className="px-4 py-2.5 text-base border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366]"
            >
              <option value="Ajuste por conteo físico">Ajuste por conteo físico</option>
              <option value="Corrección de captura">Corrección de captura</option>
              <option value="Merma">Merma</option>
              <option value="Caducado">Caducado</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-base min-w-[900px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className={thCls}>Plaza</th>
                <th className={thCls}>Lote</th>
                <th className={thCls}>Caducidad</th>
                <th className={thCls}>Ubicación</th>
                <th className={thCls}>Costo</th>
                <th className={thCls}>En sistema</th>
                <th className={thCls}>Contaste</th>
                <th className={thCls}>Diferencia</th>
                <th className="px-5 py-4" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {lotes.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-20 text-gray-400 text-base">
                    Este producto no tiene existencia en ninguna plaza. Agrega un lote abajo.
                  </td>
                </tr>
              )}
              {lotes.map(l => {
                const dif = diferenciaDe(l)
                return (
                  <tr key={l.id} className="hover:bg-gray-50/60 transition-colors">
                    <td className="px-5 py-4">
                      {l.sucursal_clave ? (
                        <span className={`text-sm font-semibold px-2.5 py-1 rounded-md whitespace-nowrap ${
                          l.sucursal_clave === 'GDL' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'
                        }`}>
                          {l.sucursal_clave}
                        </span>
                      ) : (
                        <span className="text-sm text-red-500">Sin plaza</span>
                      )}
                    </td>
                    <td className="px-5 py-4 font-mono text-sm text-gray-600">{l.lote ?? '—'}</td>
                    <td className="px-5 py-4 text-gray-600 whitespace-nowrap">{formatDia(l.caducidad)}</td>
                    <td className="px-5 py-4">
                      <span className="text-sm font-medium text-gray-600 bg-gray-100 px-2.5 py-1 rounded-md whitespace-nowrap">
                        {l.ubicacion ?? '—'}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-gray-500 whitespace-nowrap">
                      {l.costo_unitario == null ? '—' : pesos(l.costo_unitario)}
                    </td>
                    <td className="px-5 py-4">
                      <span className={`text-lg font-semibold ${
                        Number(l.existencia ?? 0) === 0 ? 'text-red-500' : 'text-gray-900'
                      }`}>
                        {piezas(l.existencia)}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <input
                        value={contados[l.id] ?? ''}
                        onChange={e => setContados(c => ({ ...c, [l.id]: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter' && dif !== null && dif !== 0) ajustar(l) }}
                        type="number"
                        min="0"
                        step="1"
                        placeholder={piezas(l.existencia)}
                        className="w-28 px-4 py-2.5 text-base border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366]"
                      />
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      {dif === null ? (
                        <span className="text-gray-300">—</span>
                      ) : dif === 0 ? (
                        <span className="text-gray-500">Cuadra</span>
                      ) : (
                        <span className={`font-semibold ${dif > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                          {dif > 0 ? '+' : '−'}{piezas(Math.abs(dif))}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <button
                        type="button"
                        onClick={() => ajustar(l)}
                        disabled={trabajando || dif === null || dif === 0 || !usuario}
                        className="px-4 py-2 text-base font-medium text-[#003366] border border-[#003366]/30 rounded-lg hover:bg-[#003366]/5 transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        Ajustar
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {lotes.length > 0 && (
              <tfoot>
                <tr className="border-t border-gray-100 bg-gray-50/50">
                  <td className="px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide" colSpan={5}>
                    Total
                  </td>
                  <td className="px-5 py-4 text-lg font-semibold text-gray-900">{piezas(totalPiezas)}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* ---- Lote nuevo --------------------------------------------------- */}
      <div className={cardCls + ' p-6'}>
        {!abriendoLote ? (
          <button type="button" onClick={() => setAbriendoLote(true)} className={btnSecundario}>
            <PlusIcon className="w-5 h-5 text-gray-400" />
            Agregar un lote
          </button>
        ) : (
          <div className="space-y-5">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Lote nuevo</h2>
              <p className="text-sm text-gray-500 mt-1">
                Entra como movimiento de entrada, con su asiento en el kardex.
              </p>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <div>
                <label className={labelCls}>Plaza</label>
                <select
                  value={nuevo.sucursal_id}
                  onChange={e => setNuevoCampo({ sucursal_id: e.target.value })}
                  className={selectCls}
                >
                  {sucursales.map(s => (
                    <option key={s.id} value={s.id}>{s.clave} · {s.nombre}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Lote</label>
                <input
                  value={nuevo.lote}
                  onChange={e => setNuevoCampo({ lote: e.target.value })}
                  autoComplete="off"
                  placeholder="Ej. 13250125"
                  className={inputCls + ' font-mono'}
                />
              </div>
              <div>
                <label className={labelCls}>Caducidad</label>
                <input
                  value={nuevo.caducidad}
                  onChange={e => setNuevoCampo({ caducidad: e.target.value })}
                  type="date"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Ubicación</label>
                <select
                  value={nuevo.ubicacion}
                  onChange={e => setNuevoCampo({ ubicacion: e.target.value })}
                  className={selectCls}
                >
                  <option value="">Sin ubicación</option>
                  {UBICACIONES.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Piezas *</label>
                <input
                  value={nuevo.piezas}
                  onChange={e => setNuevoCampo({ piezas: e.target.value })}
                  type="number" min="0" step="1"
                  placeholder="0"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Costo por pieza</label>
                <input
                  value={nuevo.costo}
                  onChange={e => setNuevoCampo({ costo: e.target.value })}
                  type="number" min="0" step="0.01"
                  placeholder="0.00"
                  className={inputCls}
                />
              </div>
              <div className="xl:col-span-3">
                <label className={labelCls}>Motivo</label>
                <select
                  value={nuevo.motivo}
                  onChange={e => setNuevoCampo({ motivo: e.target.value })}
                  className={selectCls}
                >
                  {MOTIVOS_ENTRADA.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={guardarLote}
                disabled={trabajando || !usuario || !(Number(nuevo.piezas) > 0)}
                className={btnPrimario}
              >
                {trabajando ? <ArrowPathIcon className="w-5 h-5 animate-spin" /> : <PlusIcon className="w-5 h-5" />}
                Registrar entrada
              </button>
              <button type="button" onClick={() => setAbriendoLote(false)} className="px-5 py-2.5 text-base font-medium text-gray-500 hover:text-gray-700">
                Cancelar
              </button>
              {!usuario && (
                <span className="inline-flex items-center gap-1.5 text-sm text-amber-700">
                  <ExclamationTriangleIcon className="w-4 h-4" />
                  Falta elegir quién lo hace.
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
