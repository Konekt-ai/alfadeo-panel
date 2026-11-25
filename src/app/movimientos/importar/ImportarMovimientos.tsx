'use client'

// Importar entradas y salidas desde Excel o desde el XML de una factura.
//
// Tres pasos, como la carga de conteo: subir, revisar contra el catálogo y
// aplicar. Nada se escribe hasta el último botón. Lo que el sistema no pudo
// decidir solo (dos productos parecidos, una salida de algo que no está en
// el catálogo) espera a que alguien elija.

import { useMemo, useState, useTransition } from 'react'
import {
  ArrowUpTrayIcon, ArrowDownTrayIcon, CheckCircleIcon, ExclamationTriangleIcon,
} from '@heroicons/react/20/solid'
import { pesos } from '@/lib/utils'
import {
  leerArchivoMov, huellaDe, descargarPlantilla,
  type ArchivoMov, type FilaMov, type TipoMov,
} from './leerArchivo'
import {
  revisarImportacion, aplicarImportacion,
  type Revision, type ResumenImportacion, type MovImportar,
} from './acciones'
import {
  evaluarProductos, type ProductoEvaluado, type TipoMatch,
} from '../../inventario/cargar-existencias/acciones'

interface Plaza { id: string; clave: string; nombre: string }

const NUEVO = 'nuevo'
const OMITIR = 'omitir'

const COLOR_MATCH: Record<TipoMatch, string> = {
  codigo: 'bg-emerald-100 text-emerald-800',
  nombre: 'bg-blue-100 text-blue-800',
  nuevo: 'bg-amber-100 text-amber-800',
  ambiguo: 'bg-red-100 text-red-800',
}
const LABEL_MATCH: Record<TipoMatch, string> = {
  codigo: 'Por código', nombre: 'Por nombre', nuevo: 'No está en el catálogo', ambiguo: 'Revisar',
}

const pz = (n: number) => n.toLocaleString('es-MX')
const mesAnio = (iso: string | null) =>
  iso ? new Date(iso + 'T12:00:00').toLocaleDateString('es-MX', { month: 'short', year: 'numeric' }) : '—'

export default function ImportarMovimientos({
  plazas, usuario, rfcsPropios,
}: {
  plazas: Plaza[]
  usuario: string | null
  rfcsPropios: string[]
}) {
  const [nombreArchivo, setNombreArchivo] = useState('')
  const [archivo, setArchivo] = useState<ArchivoMov | null>(null)
  const [hojaSel, setHojaSel] = useState('')
  // Sin plaza preseleccionada: el archivo no dice de dónde es.
  const [plazaId, setPlazaId] = useState('')
  // Para los archivos sin columna TIPO (o una factura de RFC desconocido).
  const [tipoTodo, setTipoTodo] = useState<TipoMov | ''>('')
  const [evaluados, setEvaluados] = useState<Map<number, ProductoEvaluado> | null>(null)
  const [decisiones, setDecisiones] = useState<Record<number, string>>({})
  const [revision, setRevision] = useState<Revision | null>(null)
  const [huella, setHuella] = useState('')
  const [avance, setAvance] = useState<{ hechas: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resumen, setResumen] = useState<ResumenImportacion | null>(null)
  const [aplicando, startAplicar] = useTransition()

  const hoja = archivo?.hojas.find(h => h.nombre === hojaSel) ?? null
  const filas = useMemo(() => hoja?.filas ?? [], [hoja])
  const faltaTipo = !!hoja && !hoja.conTipo

  const tipoDe = (f: FilaMov): TipoMov | null => f.tipo ?? (tipoTodo || null)
  const seCarga = (f: FilaMov) => !f.error && f.repetido_de === null && f.cantidad !== null

  const reiniciar = () => { setEvaluados(null); setDecisiones({}); setRevision(null); setHuella(''); setResumen(null) }

  // --- Leer ------------------------------------------------------------

  const leer = async (file: File) => {
    setError(null); reiniciar(); setTipoTodo('')
    try {
      const a = await leerArchivoMov(file, rfcsPropios)
      if (!a.hojas.length || !a.hojas.some(h => h.filas.length)) {
        setError('No se encontró ningún renglón. El Excel necesita al menos las columnas CANTIDAD y CODIGO DE BARRAS o PRODUCTO; descarga la plantilla para ver el formato.')
        return
      }
      setNombreArchivo(file.name)
      setArchivo(a)
      setHojaSel(a.hojas[0].nombre)
    } catch (e) {
      setError((e as Error).message || 'No se pudo leer el archivo. Debe ser Excel (.xlsx, .xls) o el XML de una factura.')
    }
  }

  // --- Revisar ---------------------------------------------------------

  const revisar = async () => {
    setError(null); setResumen(null)
    if (!plazaId) { setError('Elige la plaza.'); return }
    if (faltaTipo && !tipoTodo) { setError('Elige si el archivo es de entradas o de salidas.'); return }

    const cargables = filas.map((f, indice) => ({ f, indice })).filter(({ f }) => seCarga(f))
    if (!cargables.length) { setError('Ningún renglón se puede cargar: revisa los errores marcados.'); return }

    const mapa = new Map<number, ProductoEvaluado>()
    const TANDA = 50
    setAvance({ hechas: 0, total: cargables.length })
    for (let i = 0; i < cargables.length; i += TANDA) {
      const r = await evaluarProductos(cargables.slice(i, i + TANDA).map(({ f, indice }) => ({
        indice, codigo_barras: f.codigo_barras, marca: f.marca, nombre: f.nombre,
      })))
      if (r.error) { setError(r.error); setAvance(null); return }
      for (const e of r.evaluados) mapa.set(e.indice, e)
      setAvance({ hechas: Math.min(i + TANDA, cargables.length), total: cargables.length })
    }

    // Un producto que no existe sólo se puede dar de alta en una entrada;
    // sacar algo que no está en el catálogo no tiene sentido.
    const inicial: Record<number, string> = {}
    mapa.forEach((e, indice) => {
      const tipo = tipoDe(filas[indice])
      inicial[indice] = e.producto_id ?? (e.match === 'nuevo' && tipo === 'entrada' ? NUEVO : '')
    })

    const h = await huellaDe(archivo!, filas.filter(seCarga).map(f => ({ ...f, tipo: tipoDe(f) })), plazaId)
    const rev = await revisarImportacion(h, archivo?.cfdi?.uuid ?? null)

    setEvaluados(mapa); setDecisiones(inicial); setHuella(h); setRevision(rev); setAvance(null)
  }

  // --- Conteos ---------------------------------------------------------

  const cuenta = useMemo(() => {
    const c = { entradas: 0, salidas: 0, piezasE: 0, piezasS: 0, errores: 0, repetidos: 0, porRevisar: 0, nuevos: 0, omitidos: 0 }
    filas.forEach((f, i) => {
      if (f.error) { c.errores++; return }
      if (f.repetido_de !== null) { c.repetidos++; return }
      const d = decisiones[i]
      if (evaluados && d === '') { c.porRevisar++; return }
      if (d === OMITIR) { c.omitidos++; return }
      if (d === NUEVO) c.nuevos++
      if (tipoDe(f) === 'salida') { c.salidas++; c.piezasS += f.cantidad ?? 0 } else { c.entradas++; c.piezasE += f.cantidad ?? 0 }
    })
    return c
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filas, decisiones, evaluados, tipoTodo])

  // --- Aplicar ---------------------------------------------------------

  const plaza = plazas.find(p => p.id === plazaId)

  const aplicar = () => {
    if (!evaluados || !plaza || !revision || revision.bloqueo) return
    const movimientos: MovImportar[] = filas
      .map((f, i) => ({ f, d: decisiones[i] }))
      .filter(({ f, d }) => seCarga(f) && d && d !== OMITIR)
      .map(({ f, d }) => ({
        renglon: f.renglon,
        tipo: tipoDe(f)!,
        producto_id: d === NUEVO ? null : d,
        codigo_barras: f.codigo_barras, marca: f.marca, nombre: f.nombre,
        lote: f.lote, caducidad: f.caducidad, cantidad: f.cantidad!,
        ubicacion: f.ubicacion, costo: f.costo, motivo: f.motivo,
      }))

    let aunqueYaAplicado = false
    if (revision.aplicado) {
      const cuando = revision.aplicado.fecha
        ? new Date(revision.aplicado.fecha).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
        : ''
      if (!window.confirm(
        `Este archivo YA se aplicó${cuando ? ` el ${cuando}` : ''}${revision.aplicado.usuario ? ` por ${revision.aplicado.usuario}` : ''}.\n\n` +
        'Aplicarlo otra vez vuelve a mover las mismas piezas. ¿De verdad va otra vez?',
      )) return
      aunqueYaAplicado = true
    } else if (!window.confirm(
      `Se van a registrar ${cuenta.entradas} entradas (${pz(cuenta.piezasE)} pz) y ${cuenta.salidas} salidas (${pz(cuenta.piezasS)} pz) en ${plaza.nombre}. ¿Continuar?`,
    )) return

    setError(null)
    startAplicar(async () => {
      const r = await aplicarImportacion({
        sucursalId: plaza.id, archivo: nombreArchivo, huella,
        uuid: archivo?.cfdi?.uuid ?? null, movimientos, aunqueYaAplicado,
      })
      if (!r.ok) { setError(r.error); return }
      setResumen(r.resumen); setEvaluados(null); setRevision(null)
    })
  }

  const listo = !!evaluados && !!plaza && !!usuario && !revision?.bloqueo &&
    cuenta.porRevisar === 0 && cuenta.entradas + cuenta.salidas > 0

  // --- Pintar ----------------------------------------------------------

  const tarjeta = 'bg-white border border-gray-200 rounded-xl'
  const select = 'w-full px-3 py-2.5 text-base border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-[#003366]'
  const rotulo = 'block text-sm font-semibold text-gray-500 uppercase tracking-wide mb-1.5'
  const th = 'text-left px-4 py-3 text-sm font-semibold text-gray-500 uppercase tracking-wide'
  const cfdi = archivo?.cfdi

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-base flex items-start gap-2">
          <ExclamationTriangleIcon className="w-5 h-5 shrink-0 mt-0.5" />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      )}

      {resumen && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 flex items-start gap-2 text-emerald-900">
          <CheckCircleIcon className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="text-base">
            Listo: {resumen.entradas} entradas ({pz(resumen.piezasEntraron)} pz) y {resumen.salidas} salidas
            ({pz(resumen.piezasSalieron)} pz)
            {resumen.productosNuevos > 0 && <> · {resumen.productosNuevos} productos dados de alta</>}.
            <p className="mt-1 text-sm text-emerald-800">
              Cada uno quedó en Movimientos con tu nombre y el nombre del archivo. Si se vuelve a subir,
              el panel avisa que ya se aplicó.
            </p>
          </div>
        </div>
      )}

      {/* 1 · Archivo */}
      <div className={`${tarjeta} p-4 sm:p-5`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">1 · Sube el archivo</h2>
            <p className="text-base text-gray-500 mt-1">
              Excel con el formato de la plantilla, o el XML de una factura de proveedor (entrada) o
              emitida (salida).
            </p>
          </div>
          <button type="button" onClick={descargarPlantilla}
            className="shrink-0 inline-flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-300 text-gray-700 text-base font-medium rounded-lg hover:bg-gray-50 transition-colors">
            <ArrowDownTrayIcon className="w-5 h-5 text-gray-400" />
            Descargar plantilla
          </button>
        </div>

        <label className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-[#003366]/40 transition-colors text-base font-medium text-gray-700">
          <ArrowUpTrayIcon className="w-5 h-5 text-gray-400" />
          {nombreArchivo ? `${nombreArchivo} · cambiar archivo` : 'Elegir archivo'}
          <input type="file" accept=".xlsx,.xls,.xml" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) leer(f); e.target.value = '' }} />
        </label>

        {cfdi && (
          <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 space-y-0.5 break-words">
            <div><strong>Factura {[cfdi.serie, cfdi.folio].filter(Boolean).join('-') || ''}</strong> · {pesos(cfdi.total)}</div>
            <div>Emisor: {cfdi.emisor_nombre ?? '—'} ({cfdi.emisor_rfc ?? '—'})</div>
            <div>Receptor: {cfdi.receptor_nombre ?? '—'} ({cfdi.receptor_rfc ?? '—'})</div>
            <div className="font-mono text-xs text-gray-500 break-all">{cfdi.uuid ?? 'sin timbre'}</div>
          </div>
        )}

        {archivo && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-5">
            {archivo.hojas.length > 1 && (
              <div>
                <label className={rotulo}>Hoja</label>
                <select value={hojaSel} onChange={e => { setHojaSel(e.target.value); reiniciar() }} className={select}>
                  {archivo.hojas.map(h => <option key={h.nombre} value={h.nombre}>{h.nombre} · {h.filas.length} renglones</option>)}
                </select>
              </div>
            )}
            <div>
              <label className={rotulo}>Plaza</label>
              <select value={plazaId} onChange={e => { setPlazaId(e.target.value); reiniciar() }} className={select}>
                <option value="">— ¿De qué plaza? —</option>
                {plazas.map(p => <option key={p.id} value={p.id}>{p.nombre} ({p.clave})</option>)}
              </select>
            </div>
            {faltaTipo && (
              <div>
                <label className={rotulo}>{cfdi ? 'Esta factura es' : 'El archivo es de'}</label>
                <select value={tipoTodo} onChange={e => { setTipoTodo(e.target.value as TipoMov | ''); reiniciar() }} className={select}>
                  <option value="">— Elige —</option>
                  <option value="entrada">{cfdi ? 'De un proveedor: entrada' : 'Entradas'}</option>
                  <option value="salida">{cfdi ? 'Emitida por nosotros: salida' : 'Salidas'}</option>
                </select>
              </div>
            )}
          </div>
        )}

        {hoja && (
          <button onClick={revisar} disabled={avance !== null}
            className="mt-5 w-full sm:w-auto px-5 py-3 bg-[#003366] text-white text-base font-medium rounded-lg hover:bg-[#002244] disabled:opacity-50 transition-colors">
            {avance ? `Revisando ${avance.hechas} de ${avance.total}…` : 'Revisar contra el catálogo'}
          </button>
        )}
      </div>

      {/* 2 · Vista previa */}
      {hoja && (
        <div className={tarjeta}>
          <div className="px-4 sm:px-5 py-4 border-b border-gray-100 space-y-3">
            <h2 className="text-lg font-semibold text-gray-900">2 · Qué va a pasar</h2>

            {revision?.bloqueo && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-base">{revision.bloqueo}</div>
            )}
            {revision?.aplicado && (
              <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-3 text-base">
                <strong>Este archivo ya se aplicó</strong>
                {revision.aplicado.fecha && <> el {new Date(revision.aplicado.fecha).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}</>}
                {revision.aplicado.usuario && <> por {revision.aplicado.usuario}</>} ({revision.aplicado.movimientos} movimientos).
                Aplicarlo otra vez movería las mismas piezas dos veces.
              </div>
            )}

            <div className="flex flex-wrap gap-2 text-sm font-medium">
              {evaluados && <>
                <span className="px-3 py-1.5 rounded-full bg-emerald-100 text-emerald-800">{cuenta.entradas} entradas · {pz(cuenta.piezasE)} pz</span>
                <span className="px-3 py-1.5 rounded-full bg-orange-100 text-orange-800">{cuenta.salidas} salidas · {pz(cuenta.piezasS)} pz</span>
              </>}
              {cuenta.porRevisar > 0 && <span className="px-3 py-1.5 rounded-full bg-red-100 text-red-800">{cuenta.porRevisar} por revisar</span>}
              {cuenta.nuevos > 0 && <span className="px-3 py-1.5 rounded-full bg-amber-100 text-amber-800">{cuenta.nuevos} con producto nuevo</span>}
              {cuenta.repetidos > 0 && <span className="px-3 py-1.5 rounded-full bg-gray-100 text-gray-600">{cuenta.repetidos} repetidos</span>}
              {cuenta.errores > 0 && <span className="px-3 py-1.5 rounded-full bg-red-100 text-red-800">{cuenta.errores} con error</span>}
              {cuenta.omitidos > 0 && <span className="px-3 py-1.5 rounded-full bg-gray-100 text-gray-600">{cuenta.omitidos} omitidos</span>}
            </div>
            {!evaluados && (
              <p className="text-sm text-gray-500">Elige la plaza y dale a «Revisar contra el catálogo».</p>
            )}
          </div>

          <div className="overflow-x-auto max-h-[65vh]">
            <table className="w-full text-base min-w-[1000px]">
              <thead className="sticky top-0 bg-gray-50 z-10">
                <tr className="border-b border-gray-100">
                  <th className={th}>#</th>
                  <th className={th}>Tipo</th>
                  <th className={th}>Del archivo</th>
                  <th className={th}>Lote</th>
                  <th className={th}>Ubicación</th>
                  <th className={`${th} text-right`}>Cantidad</th>
                  <th className={th}>En el catálogo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filas.map((f, i) => {
                  const ev = evaluados?.get(i)
                  const d = decisiones[i]
                  const tipo = tipoDe(f)
                  const apagado = !seCarga(f) || d === OMITIR
                  const fondo = f.error || (ev && d === '') ? 'bg-red-50/50' : apagado ? 'bg-gray-50/60' : ''
                  return (
                    <tr key={i} className={`${fondo} align-top`}>
                      <td className="px-4 py-3 text-sm text-gray-400">{f.renglon}</td>
                      <td className="px-4 py-3">
                        {tipo ? (
                          <span className={`text-sm font-semibold px-2.5 py-1 rounded-md ${tipo === 'entrada' ? 'bg-emerald-100 text-emerald-800' : 'bg-orange-100 text-orange-800'}`}>
                            {tipo === 'entrada' ? 'Entrada' : 'Salida'}
                          </span>
                        ) : <span className="text-sm text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3 min-w-[260px]">
                        <div className={apagado ? 'text-gray-500' : 'font-medium text-gray-900'}>
                          {f.marca && <span className="font-semibold">{f.marca} · </span>}{f.nombre ?? '—'}
                        </div>
                        <div className="text-sm text-gray-500 mt-0.5">
                          {[f.codigo_barras, f.motivo].filter(Boolean).join(' · ') || 'sin código'}
                        </div>
                        {f.error && <div className="text-sm text-red-700 mt-1">{f.error}</div>}
                        {f.repetido_de !== null && <div className="text-sm text-gray-500 mt-1">Igual al renglón {f.repetido_de}: se toma una sola vez.</div>}
                        {f.avisos.map((a, k) => <div key={k} className="text-sm text-amber-700 mt-1">{a}</div>)}
                        {ev?.nota && <div className="text-sm text-amber-700 mt-1">{ev.nota}</div>}
                      </td>
                      <td className="px-4 py-3 text-sm whitespace-nowrap">
                        <div className="font-mono">{f.lote ?? (tipo === 'salida' ? 'el que caduca primero' : 'sin lote')}</div>
                        {f.caducidad && <div className="text-gray-500 mt-0.5">{mesAnio(f.caducidad)}</div>}
                      </td>
                      <td className="px-4 py-3 text-sm whitespace-nowrap">{f.ubicacion ?? '—'}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap font-semibold">
                        {f.cantidad !== null ? pz(f.cantidad) : '—'}
                      </td>
                      <td className="px-4 py-3 min-w-[300px]">
                        {!ev ? (
                          <span className="text-sm text-gray-300">—</span>
                        ) : ev.match === 'codigo' ? (
                          <div className="text-sm">
                            <span className={`font-medium px-2 py-0.5 rounded-md mr-2 ${COLOR_MATCH.codigo}`}>{LABEL_MATCH.codigo}</span>
                            {ev.candidatos[0]?.nombre}
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            <span className={`text-sm font-medium px-2 py-0.5 rounded-md ${COLOR_MATCH[ev.match]}`}>{LABEL_MATCH[ev.match]}</span>
                            <select value={d ?? ''} onChange={e => setDecisiones(x => ({ ...x, [i]: e.target.value }))}
                              className={`${select} text-sm py-2 ${d === '' ? 'border-red-300' : ''}`}>
                              {d === '' && <option value="">— Elige qué producto es —</option>}
                              {ev.candidatos.map(c => (
                                <option key={c.id} value={c.id}>
                                  {c.nombre}{c.score !== null ? ` (${Math.round(c.score * 100)}%)` : ''}{c.codigo_barras ? ` · ${c.codigo_barras}` : ''}
                                </option>
                              ))}
                              {tipo === 'entrada' && <option value={NUEVO}>Dar de alta como producto nuevo</option>}
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
            <div className="px-4 sm:px-5 py-4 bg-gray-50 border-t border-gray-200 space-y-3">
              {!usuario && <p className="text-base text-amber-800">Elige tu nombre arriba: los movimientos quedan firmados.</p>}
              {cuenta.porRevisar > 0 && (
                <p className="text-base text-red-700">
                  Faltan {cuenta.porRevisar} renglones por revisar (en rojo): elige el producto o márcalo como «No cargar».
                </p>
              )}
              <button onClick={aplicar} disabled={!listo || aplicando}
                className="w-full sm:w-auto px-6 py-3.5 bg-[#003366] text-white text-base font-semibold rounded-lg hover:bg-[#002244] disabled:opacity-50 transition-colors">
                {aplicando ? 'Aplicando…' : revision?.aplicado ? 'Aplicar otra vez' : 'Aplicar movimientos'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
