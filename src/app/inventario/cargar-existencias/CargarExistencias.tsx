'use client'

// Carga de existencias desde el Excel del conteo de almacén.
//
// Tres pasos, como el importador de Aspel: subir el archivo, revisar contra
// el catálogo y aplicar. Nada se escribe hasta el último botón, y lo que
// el sistema no pudo decidir solo (dos productos casi iguales, un nombre
// que coincide con otro código) se queda esperando a que alguien elija:
// meter piezas al producto equivocado es peor que tardarse un minuto más.

import { useMemo, useState, useTransition } from 'react'
import {
  ArrowUpTrayIcon, CheckCircleIcon, ExclamationTriangleIcon,
} from '@heroicons/react/20/solid'
import { leerLibro, type HojaConteo, type FilaConteo } from './leerExcel'
import {
  evaluarProductos, aplicarConteo,
  type ProductoEvaluado, type ResumenCarga, type TipoMatch,
} from './acciones'

interface Plaza { id: string; clave: string; nombre: string }

// La decisión de cada renglón: el id de un producto, darlo de alta u omitirlo.
// '' = todavía nadie decide (sólo pasa en los ambiguos).
type Decision = string
const NUEVO = 'nuevo'
const OMITIR = 'omitir'

const COLOR_MATCH: Record<TipoMatch, string> = {
  codigo:  'bg-emerald-100 text-emerald-800',
  nombre:  'bg-blue-100 text-blue-800',
  nuevo:   'bg-amber-100 text-amber-800',
  ambiguo: 'bg-red-100 text-red-800',
}

const LABEL_MATCH: Record<TipoMatch, string> = {
  codigo:  'Por código',
  nombre:  'Por nombre',
  nuevo:   'Producto nuevo',
  ambiguo: 'Revisar',
}

/** Un renglón se carga si tiene piezas, no tiene error y no es copia de otro. */
const seCarga = (f: FilaConteo) => f.piezas !== null && !f.error && f.repetido_de === null

const mesAnio = (iso: string | null) =>
  iso
    ? new Date(iso + 'T12:00:00').toLocaleDateString('es-MX', { month: 'short', year: 'numeric' })
    : 'sin caducidad'

const pz = (n: number) => n.toLocaleString('es-MX')

export default function CargarExistencias({
  plazas, usuario,
}: {
  plazas: Plaza[]
  usuario: string | null
}) {
  const [archivo, setArchivo] = useState<string>('')
  const [hojas, setHojas] = useState<HojaConteo[]>([])
  const [hojaSel, setHojaSel] = useState<string>('')
  // A propósito sin plaza preseleccionada, ni siquiera la del encabezado: el
  // Excel no dice de dónde es, y cargarlo en la plaza equivocada es fácil de
  // no notar.
  const [plazaId, setPlazaId] = useState<string>('')
  const [evaluados, setEvaluados] = useState<Map<number, ProductoEvaluado> | null>(null)
  const [decisiones, setDecisiones] = useState<Record<number, Decision>>({})
  const [avance, setAvance] = useState<{ hechas: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resumen, setResumen] = useState<ResumenCarga | null>(null)
  const [aplicando, startAplicar] = useTransition()

  const hoja = hojas.find(h => h.nombre === hojaSel) ?? null
  const filas = hoja?.filas ?? []

  // --- Leer el archivo -------------------------------------------------

  const leer = async (file: File) => {
    setError(null); setEvaluados(null); setDecisiones({}); setResumen(null)
    try {
      const libro = leerLibro(await file.arrayBuffer())
      if (!libro.length) {
        setError('No se encontró ninguna hoja con encabezados de inventario (LOTE, PIEZAS, UBICACIÓN...).')
        return
      }
      setArchivo(file.name)
      setHojas(libro)
      // Por omisión, la primera hoja que no sea la de caducados (PNC).
      setHojaSel((libro.find(h => !/pnc|caducad/i.test(h.nombre)) ?? libro[0]).nombre)
    } catch {
      setError('No se pudo leer el archivo. Debe ser el Excel del conteo (.xlsx o .xls).')
    }
  }

  const cambiarHoja = (nombre: string) => {
    setHojaSel(nombre); setEvaluados(null); setDecisiones({}); setResumen(null)
  }

  // --- Revisar contra el catálogo -------------------------------------

  const revisar = async () => {
    setError(null); setResumen(null)
    // Sólo los que se van a cargar: los que no se han contado no hace falta
    // buscarlos todavía.
    const porBuscar = filas
      .map((f, indice) => ({ f, indice }))
      .filter(({ f }) => seCarga(f))
      .map(({ f, indice }) => ({ indice, codigo_barras: f.codigo_barras, marca: f.marca, nombre: f.nombre }))

    if (!porBuscar.length) {
      setError('Esta hoja no tiene ningún renglón con piezas capturadas.')
      return
    }

    const mapa = new Map<number, ProductoEvaluado>()
    const TANDA = 50
    setAvance({ hechas: 0, total: porBuscar.length })
    for (let i = 0; i < porBuscar.length; i += TANDA) {
      const r = await evaluarProductos(porBuscar.slice(i, i + TANDA))
      if (r.error) { setError(r.error); setAvance(null); return }
      for (const e of r.evaluados) mapa.set(e.indice, e)
      setAvance({ hechas: Math.min(i + TANDA, porBuscar.length), total: porBuscar.length })
    }

    // Un dudoso que viene en 0 no detiene la carga: no hay piezas que meter
    // en el producto equivocado. Se deja en «No cargar» y quien quiera lo
    // cambia.
    const inicial: Record<number, Decision> = {}
    mapa.forEach((e, indice) => {
      inicial[indice] = e.producto_id
        ?? (e.match === 'nuevo' ? NUEVO : filas[indice].piezas === 0 ? OMITIR : '')
    })
    setEvaluados(mapa)
    setDecisiones(inicial)
    setAvance(null)
  }

  // --- Conteos ---------------------------------------------------------

  const cuenta = useMemo(() => {
    const c = { cargan: 0, piezas: 0, sinContar: 0, errores: 0, repetidos: 0, nuevos: 0, porRevisar: 0, omitidos: 0 }
    filas.forEach((f, i) => {
      if (f.error) { c.errores++; return }
      if (f.repetido_de !== null) { c.repetidos++; return }
      if (f.piezas === null) { c.sinContar++; return }
      const d = decisiones[i]
      if (evaluados && d === '') { c.porRevisar++; return }
      if (d === OMITIR) { c.omitidos++; return }
      if (d === NUEVO) c.nuevos++
      c.cargan++
      c.piezas += f.piezas
    })
    return c
  }, [filas, decisiones, evaluados])

  // --- Aplicar ---------------------------------------------------------

  const plaza = plazas.find(p => p.id === plazaId)

  const aplicar = () => {
    if (!evaluados || !plaza) return
    const lotes = filas
      .map((f, i) => ({ f, d: decisiones[i] }))
      .filter(({ f, d }) => seCarga(f) && d && d !== OMITIR)
      .map(({ f, d }) => ({
        renglon: f.renglon,
        producto_id: d === NUEVO ? null : d,
        codigo_barras: f.codigo_barras,
        marca: f.marca,
        nombre: f.nombre,
        laboratorio: f.laboratorio,
        lote: f.lote,
        caducidad: f.caducidad,
        ubicacion: f.ubicacion,
        piezas: f.piezas!,
      }))

    if (!window.confirm(
      `Se van a cargar ${lotes.length} lotes (${pz(cuenta.piezas)} piezas) en ${plaza.nombre}.\n\n` +
      'Cada lote queda con lo que dice el Excel. ¿Continuar?',
    )) return

    setError(null)
    startAplicar(async () => {
      const r = await aplicarConteo(plaza.id, `${archivo} · ${hojaSel}`, lotes)
      if (!r.ok) { setError(r.error); return }
      setResumen(r.resumen)
      setEvaluados(null)
    })
  }

  const listo = !!evaluados && !!plaza && !!usuario && cuenta.porRevisar === 0 && cuenta.cargan > 0

  // --- Pintar ----------------------------------------------------------

  const tarjeta = 'bg-white border border-gray-200 rounded-xl'
  const select = 'w-full px-3 py-2.5 text-base border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-[#003366]'
  const th = 'text-left px-4 py-3 text-sm font-semibold text-gray-500 uppercase tracking-wide'

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-base flex items-start gap-2">
          <ExclamationTriangleIcon className="w-5 h-5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {resumen && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5">
          <div className="flex items-start gap-2 text-emerald-900">
            <CheckCircleIcon className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="text-base">
              Inventario cargado: <strong>{pz(resumen.piezas)} piezas</strong>.{' '}
              {resumen.lotesAjustados} lotes ajustados · {resumen.lotesNuevos} lotes nuevos
              {resumen.sinCambio > 0 && <> · {resumen.sinCambio} ya cuadraban</>}
              {resumen.enCero > 0 && <> · {resumen.enCero} venían en 0 y no tenían lote</>}
              {resumen.productosNuevos > 0 && <> · {resumen.productosNuevos} productos dados de alta</>}
              {resumen.codigosAsignados > 0 && <> · {resumen.codigosAsignados} códigos de barras registrados</>}
              {resumen.reactivados > 0 && <> · {resumen.reactivados} productos reactivados</>}.
              <p className="mt-1 text-sm text-emerald-800">
                Cada cambio quedó en el kardex como ajuste por conteo, firmado por {usuario}.
              </p>
            </div>
          </div>
          {resumen.omitidos.length > 0 && (
            <ul className="mt-3 text-sm text-amber-800 list-disc list-inside space-y-0.5">
              {resumen.omitidos.map((o, i) => <li key={i}>{o}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* 1 · Archivo, hoja y plaza */}
      <div className={`${tarjeta} p-5`}>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">1 · Sube el Excel del conteo</h2>
        <p className="text-base text-gray-500 mb-4">
          El de «Existencias en almacén»: código de barras, marca, producto, laboratorio, lote,
          caducidad, piezas y ubicación. Los renglones con la columna de piezas vacía no se cargan.
        </p>
        <label className="inline-flex items-center gap-2 px-5 py-3 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-[#003366]/40 transition-colors text-base font-medium text-gray-700">
          <ArrowUpTrayIcon className="w-5 h-5 text-gray-400" />
          {archivo ? `${archivo} · cambiar archivo` : 'Elegir archivo'}
          <input
            type="file" accept=".xlsx,.xls" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) leer(f); e.target.value = '' }}
          />
        </label>

        {hojas.length > 0 && (
          <div className="grid sm:grid-cols-2 gap-4 mt-5">
            <div>
              <label className="block text-sm font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Hoja</label>
              <select value={hojaSel} onChange={e => cambiarHoja(e.target.value)} className={select}>
                {hojas.map(h => (
                  <option key={h.nombre} value={h.nombre}>
                    {h.nombre} · {h.filas.filter(seCarga).length} de {h.filas.length} renglones con piezas
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Plaza</label>
              <select value={plazaId} onChange={e => setPlazaId(e.target.value)} className={select}>
                <option value="">— ¿De qué plaza es este conteo? —</option>
                {plazas.map(p => <option key={p.id} value={p.id}>{p.nombre} ({p.clave})</option>)}
              </select>
            </div>
          </div>
        )}

        {hoja && (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              onClick={revisar}
              disabled={avance !== null}
              className="px-5 py-3 bg-[#003366] text-white text-base font-medium rounded-lg hover:bg-[#002244] disabled:opacity-50 transition-colors"
            >
              {avance ? `Revisando ${avance.hechas} de ${avance.total}…` : 'Revisar contra el catálogo'}
            </button>
            {avance && (
              <div className="flex-1 min-w-[160px] h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#003366] transition-all"
                  style={{ width: `${Math.round((avance.hechas / Math.max(avance.total, 1)) * 100)}%` }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2 · Vista previa */}
      {hoja && (
        <div className={tarjeta}>
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900">2 · Qué va a pasar</h2>
            <div className="flex flex-wrap gap-2 mt-3 text-sm font-medium">
              {evaluados && (
                <span className="px-3 py-1.5 rounded-full bg-emerald-100 text-emerald-800">
                  {cuenta.cargan} lotes se cargan · {pz(cuenta.piezas)} piezas
                </span>
              )}
              {cuenta.porRevisar > 0 && (
                <span className="px-3 py-1.5 rounded-full bg-red-100 text-red-800">{cuenta.porRevisar} por revisar</span>
              )}
              {cuenta.nuevos > 0 && (
                <span className="px-3 py-1.5 rounded-full bg-amber-100 text-amber-800">{cuenta.nuevos} con producto nuevo</span>
              )}
              <span className="px-3 py-1.5 rounded-full bg-gray-100 text-gray-600">{cuenta.sinContar} sin contar</span>
              {cuenta.repetidos > 0 && (
                <span className="px-3 py-1.5 rounded-full bg-gray-100 text-gray-600">{cuenta.repetidos} repetidos</span>
              )}
              {cuenta.errores > 0 && (
                <span className="px-3 py-1.5 rounded-full bg-red-100 text-red-800">{cuenta.errores} con error</span>
              )}
              {cuenta.omitidos > 0 && (
                <span className="px-3 py-1.5 rounded-full bg-gray-100 text-gray-600">{cuenta.omitidos} omitidos</span>
              )}
            </div>
            {!evaluados && (
              <p className="text-sm text-gray-500 mt-3">
                Dale a «Revisar contra el catálogo» para ver a qué producto va cada renglón.
              </p>
            )}
          </div>

          <div className="overflow-x-auto max-h-[65vh]">
            <table className="w-full text-base min-w-[1100px]">
              <thead className="sticky top-0 bg-gray-50 z-10">
                <tr className="border-b border-gray-100">
                  <th className={th}>#</th>
                  <th className={th}>Del Excel</th>
                  <th className={th}>Lote</th>
                  <th className={th}>Ubicación</th>
                  <th className={`${th} text-right`}>Piezas</th>
                  <th className={th}>En el catálogo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filas.map((f, i) => {
                  const ev = evaluados?.get(i)
                  const d = decisiones[i]
                  const apagado = !seCarga(f) || d === OMITIR
                  const fondo = f.error || (ev && d === '')
                    ? 'bg-red-50/50'
                    : apagado ? 'bg-gray-50/60 text-gray-400' : ''
                  return (
                    <tr key={i} className={`${fondo} align-top`}>
                      <td className="px-4 py-3 text-sm text-gray-400">{f.renglon}</td>
                      <td className="px-4 py-3">
                        <div className={apagado ? 'text-gray-500' : 'font-medium text-gray-900'}>
                          {f.marca && <span className="font-semibold">{f.marca} · </span>}
                          {f.nombre ?? '—'}
                        </div>
                        <div className="text-sm text-gray-500 mt-0.5">
                          {[f.laboratorio, f.codigo_barras].filter(Boolean).join(' · ') || 'sin código'}
                        </div>
                        {f.error && <div className="text-sm text-red-700 mt-1">{f.error}</div>}
                        {f.repetido_de !== null && (
                          <div className="text-sm text-gray-500 mt-1">
                            Repetido del renglón {f.repetido_de}: se toma sólo aquel.
                          </div>
                        )}
                        {f.avisos.map((a, k) => <div key={k} className="text-sm text-amber-700 mt-1">{a}</div>)}
                        {ev?.nota && <div className="text-sm text-amber-700 mt-1">{ev.nota}</div>}
                      </td>
                      <td className="px-4 py-3 text-sm whitespace-nowrap">
                        <div className="font-mono">{f.lote ?? 'sin lote'}</div>
                        <div className="text-gray-500 mt-0.5">{mesAnio(f.caducidad)}</div>
                      </td>
                      <td className="px-4 py-3 text-sm whitespace-nowrap">{f.ubicacion ?? 'sin ubicación'}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {f.piezas === null
                          ? <span className="text-sm text-gray-400">sin contar</span>
                          : <span className="font-semibold">{pz(f.piezas)}</span>}
                      </td>
                      <td className="px-4 py-3 min-w-[320px]">
                        {!ev ? (
                          <span className="text-sm text-gray-300">—</span>
                        ) : ev.match === 'codigo' ? (
                          <div className="text-sm">
                            <span className={`font-medium px-2 py-0.5 rounded-md mr-2 ${COLOR_MATCH.codigo}`}>
                              {LABEL_MATCH.codigo}
                            </span>
                            {ev.candidatos[0]?.nombre}
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            <span className={`text-sm font-medium px-2 py-0.5 rounded-md ${COLOR_MATCH[ev.match]}`}>
                              {LABEL_MATCH[ev.match]}
                            </span>
                            <select
                              value={d ?? ''}
                              onChange={e => setDecisiones(x => ({ ...x, [i]: e.target.value }))}
                              className={`${select} text-sm py-2 ${d === '' ? 'border-red-300' : ''}`}
                            >
                              {d === '' && <option value="">— Elige qué producto es —</option>}
                              {ev.candidatos.map(c => (
                                <option key={c.id} value={c.id}>
                                  {c.nombre}
                                  {c.score !== null ? ` (${Math.round(c.score * 100)}%)` : ''}
                                  {c.codigo_barras ? ` · ${c.codigo_barras}` : ''}
                                </option>
                              ))}
                              <option value={NUEVO}>Dar de alta como producto nuevo</option>
                              <option value={OMITIR}>No cargar este renglón</option>
                            </select>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {evaluados && (
            <div className="px-5 py-4 bg-gray-50 border-t border-gray-200 space-y-3">
              {!usuario && (
                <p className="text-base text-amber-800">
                  Elige tu nombre arriba: la carga queda firmada en el kardex.
                </p>
              )}
              {!plaza && <p className="text-base text-amber-800">Elige de qué plaza es este conteo.</p>}
              {cuenta.porRevisar > 0 && (
                <p className="text-base text-red-700">
                  Faltan {cuenta.porRevisar} renglones por revisar (en rojo). Elige el producto, dalo de
                  alta o márcalo como «No cargar».
                </p>
              )}
              <button
                onClick={aplicar}
                disabled={!listo || aplicando}
                className="w-full sm:w-auto px-6 py-3.5 bg-[#003366] text-white text-base font-semibold rounded-lg hover:bg-[#002244] disabled:opacity-50 transition-colors"
              >
                {aplicando
                  ? 'Cargando…'
                  : `Cargar ${cuenta.cargan} lotes${plaza ? ` en ${plaza.nombre}` : ''}`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
