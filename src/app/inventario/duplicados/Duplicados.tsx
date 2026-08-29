'use client'

// Tarjetas de duplicados: un grupo por nombre repetido o por código repetido.
//
// La decisión que se toma aquí es "cuál de estas copias es la buena". Por eso
// la tabla enseña lo único que importa para decidirlo: cuánta existencia y
// cuánto historial (movimientos y ventas) trae cada una. El que más historial
// tiene es el que conviene conservar, y viene marcado como sugerido, pero la
// última palabra es de la persona: el radio se puede mover.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowsPointingInIcon, ExclamationTriangleIcon, CheckCircleIcon,
  LinkSlashIcon, StarIcon, XMarkIcon,
} from '@heroicons/react/20/solid'
import { nombreProducto } from '@/lib/utils'
import { fusionarProductos, quitarCodigoBarras } from './acciones'

// Una fila de v_productos_duplicados.
export interface FilaDuplicado {
  producto_id: string
  nombre: string | null
  nombre_comercial: string | null
  nombre_generico: string | null
  codigo_barras: string | null
  activo: boolean
  stock: number | null
  // Cuántos renglones de historial trae: movimientos de inventario y ventas.
  historial: number | null
  clave_nombre: string | null
  copias_mismo_nombre: number | null
  copias_mismo_codigo: number | null
  // Llega como texto a propósito: la vista puede entregarlo como el uuid del
  // destino o como bandera. La página resuelve las dos formas.
  sugerido_destino: string | null
}

export interface GrupoDuplicado {
  /** Clave estable para React y para el name de los radios. */
  clave: string
  /** Por qué chocan: mismo nombre, o mismo código de barras. */
  tipo: 'nombre' | 'codigo'
  titulo: string
  /** Producto que la vista (o el historial) recomienda conservar. */
  destinoSugerido: string
  filas: FilaDuplicado[]
}

const num = (v: number | null | undefined) => Number(v ?? 0)

const BOTON_PRIMARIO =
  'inline-flex items-center gap-2 px-5 py-2.5 bg-[#003366] text-white text-base font-medium ' +
  'rounded-lg hover:bg-[#002244] transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

export default function Duplicados({ grupos }: { grupos: GrupoDuplicado[] }) {
  return (
    <div className="space-y-6">
      {grupos.map(g => <TarjetaGrupo key={g.clave} grupo={g} />)}
    </div>
  )
}

function TarjetaGrupo({ grupo }: { grupo: GrupoDuplicado }) {
  const router = useRouter()
  const [destinoElegido, setDestino] = useState(grupo.destinoSugerido)
  const [confirmar, setConfirmar] = useState(false)
  const [acepta, setAcepta] = useState(false)
  const [trabajando, setTrabajando] = useState(false)
  const [quitando, setQuitando] = useState<string | null>(null)
  const [porQuitar, setPorQuitar] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)
  const [, refrescar] = useTransition()

  // El grupo se vuelve a armar en el servidor después de cada operación (se le
  // quitó el código a uno, otra persona fusionó): si el que estaba elegido ya
  // no está en la lista, se regresa al sugerido. Si no, no quedaría ningún
  // radio marcado, TODOS los renglones dirían "Se elimina" y fusionar mandaría
  // a la base un producto que ya no existe.
  const destino = grupo.filas.some(f => f.producto_id === destinoElegido)
    ? destinoElegido
    : grupo.destinoSugerido

  const conservado = grupo.filas.find(f => f.producto_id === destino) ?? grupo.filas[0]
  const aFusionar = grupo.filas.filter(f => f.producto_id !== destino)
  const stockQueSeMueve = aFusionar.reduce((s, f) => s + num(f.stock), 0)
  const historialQueSeMueve = aFusionar.reduce((s, f) => s + num(f.historial), 0)

  // Dos productos DISTINTOS con el mismo código y existencia en los dos no se
  // pueden fusionar a ciegas: sumaría existencia de dos medicamentos que no
  // son el mismo. Ese caso se desempata quitándole el código a uno.
  const conExistencia = grupo.filas.filter(f => num(f.stock) > 0).length
  const requiereOjoHumano = grupo.tipo === 'codigo' && conExistencia > 1

  const fusionar = async () => {
    setMensaje(null)
    setTrabajando(true)
    const res = await fusionarProductos(destino, aFusionar.map(f => f.producto_id))
    setTrabajando(false)
    if (!res.ok) {
      setMensaje({ tipo: 'error', texto: res.error })
      return
    }
    setConfirmar(false)
    setAcepta(false)
    setMensaje({ tipo: 'ok', texto: res.mensaje })
    refrescar(() => router.refresh())
  }

  const quitarCodigo = async (id: string) => {
    setMensaje(null)
    setPorQuitar(null)
    setQuitando(id)
    const res = await quitarCodigoBarras(id)
    setQuitando(null)
    if (!res.ok) {
      setMensaje({ tipo: 'error', texto: res.error })
      return
    }
    setMensaje({ tipo: 'ok', texto: res.mensaje })
    refrescar(() => router.refresh())
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      {/* Encabezado del grupo */}
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4 border-b border-gray-100">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-gray-900 break-words">{grupo.titulo}</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {grupo.filas.length} productos capturados para lo mismo ·{' '}
            {grupo.tipo === 'codigo' ? 'chocan por código de barras' : 'chocan por nombre'}
          </p>
        </div>
        <span className={`px-3.5 py-1.5 rounded-full text-sm font-medium border whitespace-nowrap ${
          grupo.tipo === 'codigo'
            ? 'bg-amber-50 text-amber-800 border-amber-200'
            : 'bg-blue-50 text-blue-800 border-blue-200'
        }`}>
          {grupo.tipo === 'codigo' ? 'Mismo código' : 'Mismo nombre'}
        </span>
      </div>

      {requiereOjoHumano && (
        <div className="flex items-start gap-2.5 bg-amber-50 border-b border-amber-200 text-amber-900 px-5 py-4 text-base">
          <ExclamationTriangleIcon className="w-5 h-5 mt-0.5 shrink-0" />
          <span>
            <strong className="block">Este caso necesita que lo decida una persona.</strong>
            Comparten código pero {conExistencia} tienen existencia. Si son el mismo
            producto, fusiona y la existencia se suma. Si son productos distintos que
            por error quedaron con el mismo código, no los fusiones: quítale el código
            al que no le corresponde y captúrale el suyo.
          </span>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-base min-w-[860px]">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Conservar</th>
              <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Producto</th>
              <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Código</th>
              <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Activo</th>
              <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Existencia</th>
              <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Historial</th>
              <th className="px-5 py-4" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {grupo.filas.map(f => {
              const elegido = f.producto_id === destino
              const sugerido = f.producto_id === grupo.destinoSugerido
              return (
                <tr key={f.producto_id} className={elegido ? 'bg-[#003366]/5' : undefined}>
                  <td className="px-5 py-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name={`destino-${grupo.clave}`}
                        value={f.producto_id}
                        checked={elegido}
                        onChange={() => { setDestino(f.producto_id); setMensaje(null) }}
                        className="w-5 h-5 accent-[#003366]"
                        aria-label={`Conservar ${nombreProducto(f)}`}
                      />
                      <span className={`text-sm font-medium whitespace-nowrap ${elegido ? 'text-[#003366]' : 'text-gray-400'}`}>
                        {elegido ? 'Se conserva' : 'Se elimina'}
                      </span>
                    </label>
                  </td>
                  <td className="px-5 py-4">
                    <div className="font-semibold text-gray-900 flex items-center gap-2 flex-wrap">
                      {nombreProducto(f)}
                      {sugerido && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                          <StarIcon className="w-3.5 h-3.5" />
                          Sugerido
                        </span>
                      )}
                    </div>
                    {f.nombre_generico && f.nombre_generico !== f.nombre_comercial && (
                      <div className="text-sm text-gray-500 mt-0.5">{f.nombre_generico}</div>
                    )}
                  </td>
                  <td className="px-5 py-4 font-mono text-sm text-gray-600 whitespace-nowrap">
                    {f.codigo_barras ?? <span className="font-sans text-gray-400">Sin código</span>}
                  </td>
                  <td className="px-5 py-4">
                    <span className={`text-sm font-semibold px-2.5 py-1 rounded-md whitespace-nowrap ${
                      f.activo ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {f.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`text-lg font-semibold ${num(f.stock) === 0 ? 'text-gray-400' : 'text-gray-900'}`}>
                      {num(f.stock).toLocaleString('es-MX')}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`text-base ${num(f.historial) === 0 ? 'text-gray-400' : 'text-gray-700 font-medium'}`}>
                      {num(f.historial) === 0
                        ? 'Sin usar'
                        : `${num(f.historial).toLocaleString('es-MX')} movimientos y ventas`}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-right">
                    {/* Sólo en los choques de código: es lo que desempata sin
                        perder nada cuando no son el mismo producto. */}
                    {grupo.tipo === 'codigo' && f.codigo_barras && (
                      porQuitar === f.producto_id ? (
                        <span className="inline-flex items-center gap-3 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => quitarCodigo(f.producto_id)}
                            disabled={quitando !== null}
                            className="text-sm font-semibold text-amber-700 hover:underline disabled:opacity-50"
                          >
                            Sí, quitarle el código
                          </button>
                          <button
                            type="button"
                            onClick={() => setPorQuitar(null)}
                            className="text-sm font-medium text-gray-400 hover:text-gray-600"
                          >
                            Cancelar
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => { setPorQuitar(f.producto_id); setMensaje(null) }}
                          disabled={quitando !== null}
                          title="Deja el código libre para el otro producto. No borra existencia ni historial."
                          className="inline-flex items-center gap-1.5 text-sm font-medium text-[#003366] hover:underline disabled:opacity-50 whitespace-nowrap"
                        >
                          <LinkSlashIcon className="w-4 h-4" />
                          {quitando === f.producto_id ? 'Quitando...' : 'Quitar el código a este'}
                        </button>
                      )
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {mensaje && !confirmar && (
        <div className={`flex items-start gap-2.5 px-5 py-4 text-base border-t ${
          mensaje.tipo === 'ok'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          {mensaje.tipo === 'ok'
            ? <CheckCircleIcon className="w-5 h-5 mt-0.5 shrink-0" />
            : <ExclamationTriangleIcon className="w-5 h-5 mt-0.5 shrink-0" />}
          <span>{mensaje.texto}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 border-t border-gray-100 bg-gray-50/50">
        <p className="text-sm text-gray-500 max-w-2xl">
          No se borra historial: las ventas y los movimientos de las copias quedan
          apuntando a{' '}
          <strong className="font-semibold text-gray-700">{nombreProducto(conservado)}</strong>,
          y su existencia se le suma.
        </p>
        <button
          type="button"
          onClick={() => { setAcepta(false); setMensaje(null); setConfirmar(true) }}
          disabled={aFusionar.length === 0 || trabajando}
          className={BOTON_PRIMARIO}
        >
          <ArrowsPointingInIcon className="w-5 h-5" />
          Fusionar en el seleccionado
        </button>
      </div>

      {/* Confirmación explícita: es irreversible y mueve existencia. */}
      {confirmar && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center sm:p-6"
          onClick={() => { if (!trabajando) setConfirmar(false) }}
        >
          <div
            className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-xl max-h-[92vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 border-b border-gray-100">
              <h3 className="text-xl font-semibold text-gray-900">Confirmar la fusión</h3>
              <button
                type="button"
                onClick={() => { if (!trabajando) setConfirmar(false) }}
                className="p-2 -mr-2 text-gray-400 hover:text-gray-600 transition-colors"
                aria-label="Cerrar"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                <p className="text-sm font-semibold text-emerald-800 uppercase tracking-wide">Se conserva</p>
                <p className="text-base text-emerald-900 mt-1">
                  {nombreProducto(conservado)}
                  {conservado.codigo_barras ? ` · ${conservado.codigo_barras}` : ''}
                </p>
              </div>

              <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                <p className="text-sm font-semibold text-red-800 uppercase tracking-wide">
                  Se {aFusionar.length === 1 ? 'elimina 1 copia' : `eliminan ${aFusionar.length} copias`}
                </p>
                <ul className="mt-1.5 space-y-1">
                  {aFusionar.map(f => (
                    <li key={f.producto_id} className="text-base text-red-900">
                      {nombreProducto(f)}
                      <span className="text-sm text-red-700">
                        {' · '}{num(f.stock).toLocaleString('es-MX')} piezas
                        {' · '}{num(f.historial).toLocaleString('es-MX')} movimientos y ventas
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <p className="text-base text-gray-600">
                Se le pasan{' '}
                <strong className="font-semibold text-gray-900">
                  {stockQueSeMueve.toLocaleString('es-MX')} piezas
                </strong>{' '}y{' '}
                <strong className="font-semibold text-gray-900">
                  {historialQueSeMueve.toLocaleString('es-MX')} renglones de historial
                </strong>{' '}
                a {nombreProducto(conservado)}. No se borra ninguna venta: las viejas
                siguen apuntando al producto que sobrevive.{' '}
                <strong className="font-semibold text-gray-900">Esto no se puede deshacer.</strong>
              </p>

              {requiereOjoHumano && (
                <label className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={acepta}
                    onChange={e => setAcepta(e.target.checked)}
                    className="mt-1 w-5 h-5 accent-[#003366]"
                  />
                  <span className="text-base text-amber-900">
                    <strong className="block">Los dos tienen existencia.</strong>
                    Confirmo que sí son el mismo producto y que su existencia debe
                    sumarse. Si no lo son, cancela y quítale el código a uno.
                  </span>
                </label>
              )}

              {mensaje?.tipo === 'error' && (
                <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-base">
                  <ExclamationTriangleIcon className="w-5 h-5 mt-0.5 shrink-0" />
                  <span>{mensaje.texto}</span>
                </div>
              )}

              <div className="flex flex-col-reverse sm:flex-row gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setConfirmar(false)}
                  disabled={trabajando}
                  className="px-5 py-3 text-base font-medium text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={fusionar}
                  disabled={trabajando || (requiereOjoHumano && !acepta)}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 bg-[#003366] text-white text-base font-medium rounded-lg hover:bg-[#002244] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ArrowsPointingInIcon className="w-5 h-5" />
                  {trabajando ? 'Fusionando...' : 'Sí, fusionar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
