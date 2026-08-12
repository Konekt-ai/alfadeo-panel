'use client'

// Alta de un traslado entre plazas (minuta 9, 37 y 5).
//
// El buscador consulta la existencia y los lotes DE LA PLAZA DE ORIGEN,
// que es lo único que se puede mandar. El lote concreto no se elige a
// mano: lo decide el FEFO al enviar (primero lo que caduca antes), y
// queda guardado en la partida para que el destino reciba exactamente lo
// mismo.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  MagnifyingGlassIcon,
  PlusIcon,
  TrashIcon,
  ArrowRightIcon,
  PaperAirplaneIcon,
} from '@heroicons/react/20/solid'
import { InformationCircleIcon } from '@heroicons/react/24/outline'
import { PAQUETERIAS } from '@/lib/constantes'
import { nombreProducto, formatDia } from '@/lib/utils'
import type { Lote, ProductoPOS } from '@/lib/types'
import { buscarProductosTraslado, crearTraslado } from '../acciones'

interface Plaza {
  id: string
  clave: string
  nombre: string
  ciudad: string | null
}

interface Props {
  plazas: Plaza[]
  origenInicial: string
  destinoInicial: string
  fechaEstimada: string
  explicacionEntrega: string
}

interface Partida {
  key: number
  producto_id: string
  descripcion: string
  cantidad: number
  // Existencia en la plaza de origen al momento de agregarla: sirve para
  // avisar antes de que el RPC rechace el envío.
  existencia: number
  lotes: Lote[]
}

let siguienteKey = 1

const inputCls =
  'w-full px-4 py-3 text-base border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366]'
const selectCls = `${inputCls} bg-white`

export default function TrasladoForm({
  plazas,
  origenInicial,
  destinoInicial,
  fechaEstimada,
  explicacionEntrega,
}: Props) {
  const router = useRouter()

  const [origenId, setOrigenId] = useState(origenInicial)
  const [destinoId, setDestinoId] = useState(destinoInicial)
  const [paqueteria, setPaqueteria] = useState(
    PAQUETERIAS.includes('DHL') ? 'DHL' : (PAQUETERIAS[0] ?? ''),
  )
  const [guia, setGuia] = useState('')
  const [fecha, setFecha] = useState(fechaEstimada)
  const [notas, setNotas] = useState('')
  const [enviarAhora, setEnviarAhora] = useState(false)

  const [q, setQ] = useState('')
  const [resultados, setResultados] = useState<ProductoPOS[]>([])
  const [buscando, setBuscando] = useState(false)
  const [sinResultados, setSinResultados] = useState(false)

  const [partidas, setPartidas] = useState<Partida[]>([])

  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  const origen = plazas.find(p => p.id === origenId)
  const destino = plazas.find(p => p.id === destinoId)
  const mismaPlaza = Boolean(origenId) && origenId === destinoId

  const piezas = partidas.reduce((s, p) => s + (Number(p.cantidad) || 0), 0)

  // La existencia es por plaza: si cambia el origen, lo buscado y lo
  // capturado deja de ser válido y se limpia.
  const cambiarOrigen = (id: string) => {
    setOrigenId(id)
    setResultados([])
    setSinResultados(false)
    setQ('')
    setPartidas([])
  }

  const buscar = async () => {
    if (!origenId) {
      setError('Elige primero la plaza que envía.')
      return
    }
    if (q.trim().length < 2) return
    setBuscando(true)
    setError(null)
    const res = await buscarProductosTraslado(q, origenId)
    setBuscando(false)
    if (res.error) {
      setError(res.error)
      setResultados([])
      setSinResultados(false)
      return
    }
    setResultados(res.productos)
    setSinResultados(res.productos.length === 0)
  }

  const agregar = (p: ProductoPOS) => {
    setPartidas(prev => {
      const ya = prev.find(x => x.producto_id === p.producto_id)
      if (ya) {
        return prev.map(x =>
          x.producto_id === p.producto_id ? { ...x, cantidad: (Number(x.cantidad) || 0) + 1 } : x,
        )
      }
      return [
        ...prev,
        {
          key: siguienteKey++,
          producto_id: p.producto_id,
          descripcion: nombreProducto(p),
          cantidad: 1,
          existencia: Number(p.existencia ?? 0),
          lotes: p.lotes ?? [],
        },
      ]
    })
  }

  const cambiarCantidad = (key: number, valor: number) => {
    setPartidas(prev => prev.map(p => (p.key === key ? { ...p, cantidad: valor } : p)))
  }

  const quitar = (key: number) => {
    setPartidas(prev => prev.filter(p => p.key !== key))
  }

  const guardar = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)

    if (!origenId || !destinoId) {
      setError('Elige la plaza que envía y la que recibe.')
      return
    }
    if (mismaPlaza) {
      setError('El origen y el destino tienen que ser plazas distintas.')
      return
    }
    if (partidas.length === 0) {
      setError('Agrega al menos una partida al traslado.')
      return
    }
    if (partidas.some(p => !(Number(p.cantidad) > 0))) {
      setError('Todas las partidas necesitan una cantidad mayor a cero.')
      return
    }

    setGuardando(true)
    const res = await crearTraslado({
      origen_id: origenId,
      destino_id: destinoId,
      paqueteria,
      guia,
      fecha_estimada: fecha,
      notas,
      enviar_ahora: enviarAhora,
      partidas: partidas.map(p => ({ producto_id: p.producto_id, cantidad: Number(p.cantidad) })),
    })

    if (!res.ok) {
      setGuardando(false)
      setError(res.error)
      return
    }

    // Si el envío inmediato falló, el traslado quedó en borrador: se
    // abre el detalle con el error del RPC para poder reintentar.
    router.push(
      res.aviso
        ? `/traslados/${res.id}?error=${encodeURIComponent(res.aviso)}`
        : `/traslados/${res.id}`,
    )
  }

  return (
    <form onSubmit={guardar} className="space-y-6 max-w-5xl">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-base">
          {error}
          {/relation|column|function|schema cache|does not exist|no existe/i.test(error) && (
            <p className="mt-2 text-sm">
              Falta correr <code className="font-mono">supabase/reunion-operacion.sql</code> en el SQL Editor de Supabase.
            </p>
          )}
        </div>
      )}

      {/* Ruta */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 md:p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Ruta</h2>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1.5">Sale de</label>
            <select
              value={origenId}
              onChange={e => cambiarOrigen(e.target.value)}
              className={selectCls}
              required
            >
              <option value="">Seleccionar...</option>
              {plazas.map(p => (
                <option key={p.id} value={p.id}>
                  {p.nombre} ({p.clave})
                </option>
              ))}
            </select>
          </div>

          <div className="hidden md:flex items-center justify-center pb-3 text-gray-300">
            <ArrowRightIcon className="w-6 h-6" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1.5">Llega a</label>
            <select
              value={destinoId}
              onChange={e => setDestinoId(e.target.value)}
              className={selectCls}
              required
            >
              <option value="">Seleccionar...</option>
              {plazas.map(p => (
                <option key={p.id} value={p.id} disabled={p.id === origenId}>
                  {p.nombre} ({p.clave})
                </option>
              ))}
            </select>
          </div>
        </div>

        {mismaPlaza && (
          <p className="mt-3 text-sm text-red-600">
            El origen y el destino tienen que ser plazas distintas.
          </p>
        )}
        <p className="mt-3 text-sm text-gray-500">
          Guadalajara y Monterrey son empresas independientes: el folio del traslado
          lo lleva la plaza que envía.
        </p>
      </div>

      {/* Envío */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 md:p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Envío</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1.5">Paquetería</label>
            <select value={paqueteria} onChange={e => setPaqueteria(e.target.value)} className={selectCls}>
              {PAQUETERIAS.map(p => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1.5">Número de guía</label>
            <input
              value={guia}
              onChange={e => setGuia(e.target.value)}
              placeholder="Ej. 1234 5678 9012"
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1.5">Llegada estimada</label>
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} className={inputCls} />
          </div>
        </div>

        <div className="mt-4 flex items-start gap-2.5 bg-blue-50/60 border border-blue-100 rounded-lg p-4">
          <InformationCircleIcon className="w-5 h-5 text-[#003366] shrink-0 mt-0.5" />
          <p className="text-sm text-gray-700">
            {explicacionEntrega} Se calcula con la regla de siempre: entrega al día
            siguiente hábil y, si sale viernes, llega el martes. Se puede cambiar a mano.
          </p>
        </div>
      </div>

      {/* Partidas */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="p-5 md:p-6 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Partidas</h2>
          <p className="text-sm text-gray-500 mt-1">
            La existencia y los lotes son los de {origen ? origen.nombre : 'la plaza de origen'}.
          </p>

          <div className="mt-4 flex gap-2">
            <div className="relative flex-1">
              <MagnifyingGlassIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                onKeyDown={e => {
                  // Enter busca; no envía el traslado sin querer.
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void buscar()
                  }
                }}
                placeholder="Buscar por nombre o código de barras..."
                className={`${inputCls} pl-11`}
              />
            </div>
            <button
              type="button"
              onClick={() => void buscar()}
              disabled={buscando || q.trim().length < 2}
              className="px-5 py-3 bg-[#003366] text-white text-base font-medium rounded-lg hover:bg-[#002244] transition-colors disabled:opacity-40"
            >
              {buscando ? 'Buscando...' : 'Buscar'}
            </button>
          </div>

          {sinResultados && (
            <p className="mt-3 text-sm text-gray-500">
              Sin resultados para “{q}”.
            </p>
          )}

          {resultados.length > 0 && (
            <ul className="mt-4 border border-gray-200 rounded-lg divide-y divide-gray-100 overflow-hidden">
              {resultados.map(p => {
                const existencia = Number(p.existencia ?? 0)
                const lotes = p.lotes ?? []
                return (
                  <li key={p.producto_id}>
                    <button
                      type="button"
                      onClick={() => agregar(p)}
                      className="w-full text-left px-4 py-4 hover:bg-[#003366]/5 transition-colors flex items-start gap-4"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-gray-900">{nombreProducto(p)}</div>
                        <div className="text-sm text-gray-500 mt-0.5">
                          {[p.concentracion, p.presentacion, p.laboratorio].filter(Boolean).join(' · ') || '—'}
                        </div>
                        {lotes.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {lotes.map((l, i) => (
                              <span
                                key={`${p.producto_id}-${l.lote ?? 'sinlote'}-${i}`}
                                className="text-xs font-medium text-gray-600 bg-gray-100 px-2 py-1 rounded-md"
                              >
                                {l.lote ?? 'sin lote'} · cad. {formatDia(l.caducidad)} · {Number(l.existencia ?? 0)} pz
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div className="text-sm text-red-600 mt-2">
                            Sin lotes con existencia en {origen?.clave ?? 'origen'}.
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div
                          className={`text-lg font-semibold ${
                            existencia === 0 ? 'text-red-500' : existencia < 10 ? 'text-amber-600' : 'text-gray-900'
                          }`}
                        >
                          {existencia}
                        </div>
                        <div className="text-xs text-gray-400 uppercase tracking-wide">
                          en {origen?.clave ?? '—'}
                        </div>
                        <span className="inline-flex items-center gap-1 text-sm font-medium text-[#003366] mt-2">
                          <PlusIcon className="w-4 h-4" /> Agregar
                        </span>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-base min-w-[720px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Producto</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Existencia en origen</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Cantidad a mandar</th>
                <th className="px-5 py-4" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {partidas.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center py-20 text-gray-400 text-base">
                    Busca un producto arriba para agregarlo al traslado.
                  </td>
                </tr>
              )}
              {partidas.map(p => {
                const excede = Number(p.cantidad) > p.existencia
                return (
                  <tr key={p.key} className="align-top">
                    <td className="px-5 py-4">
                      <div className="font-semibold text-gray-900">{p.descripcion}</div>
                      {p.lotes.length > 0 && (
                        <div className="text-sm text-gray-500 mt-1">
                          Saldrá por FEFO: {p.lotes[0].lote ?? 'sin lote'} (cad. {formatDia(p.lotes[0].caducidad)})
                          {p.lotes.length > 1 && ` y ${p.lotes.length - 1} lote(s) más si hace falta`}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-gray-700">{p.existencia}</td>
                    <td className="px-5 py-4">
                      <input
                        type="number"
                        min="1"
                        step="any"
                        inputMode="decimal"
                        value={p.cantidad}
                        onChange={e => cambiarCantidad(p.key, Number(e.target.value))}
                        className="w-32 px-4 py-3 text-base border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366]"
                        required
                      />
                      {excede && (
                        <p className="text-sm text-amber-700 mt-1.5">
                          Excede la existencia de {origen?.clave ?? 'origen'}: el envío se va a rechazar.
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <button
                        type="button"
                        onClick={() => quitar(p.key)}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-400 hover:text-red-600 transition-colors"
                      >
                        <TrashIcon className="w-4 h-4" /> Quitar
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {partidas.length > 0 && (
          <div className="border-t border-gray-100 px-5 py-4 text-base text-gray-600">
            {partidas.length} {partidas.length === 1 ? 'partida' : 'partidas'} ·{' '}
            {piezas.toLocaleString('es-MX')} piezas
          </div>
        )}
      </div>

      {/* Notas y cierre */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 md:p-6 space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-500 mb-1.5">Notas</label>
          <textarea
            rows={2}
            value={notas}
            onChange={e => setNotas(e.target.value)}
            placeholder="Ej. va junto con la factura A-1234"
            className={`${inputCls} resize-none`}
          />
        </div>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={enviarAhora}
            onChange={e => setEnviarAhora(e.target.checked)}
            className="w-5 h-5 mt-0.5 rounded border-gray-300 text-[#003366] focus:ring-[#003366]/30"
          />
          <span className="text-base text-gray-700">
            Enviar ahora
            <span className="block text-sm text-gray-500 mt-0.5">
              Descuenta la mercancía de {origen?.nombre ?? 'la plaza de origen'} y lo deja en
              tránsito. Si no lo marcas, queda en borrador y lo puedes enviar después.
            </span>
          </span>
        </label>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          type="submit"
          disabled={guardando || partidas.length === 0 || mismaPlaza}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#003366] text-white text-base font-medium rounded-lg hover:bg-[#002244] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <PaperAirplaneIcon className="w-5 h-5" />
          {guardando ? 'Guardando...' : enviarAhora ? 'Guardar y enviar' : 'Guardar borrador'}
        </button>
        <a
          href="/traslados"
          className="inline-flex items-center justify-center px-5 py-2.5 text-base font-medium text-gray-500 hover:text-gray-700 transition-colors"
        >
          Cancelar
        </a>
      </div>
    </form>
  )
}
