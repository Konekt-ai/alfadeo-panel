'use client'

// Importador del catálogo de Aspel (minuta 22, 25).
//
// El archivo se lee en el navegador para poder enseñar el mapeo de columnas
// antes de mandar nada: los encabezados de Aspel SAE (CVE_ART, DESCR...) se
// adivinan solos, pero el operador tiene que poder corregirlos, porque cada
// exportación sale distinta.
//
// La evaluación contra el catálogo va por tandas, con barra de avance: un
// catálogo completo son miles de filas y cada una consulta el ranking de
// búsqueda.

import { useState, useMemo, useTransition } from 'react'
import * as XLSX from 'xlsx'
import {
  ArrowUpTrayIcon, CheckCircleIcon, ExclamationTriangleIcon,
} from '@heroicons/react/20/solid'
import { pesos } from '@/lib/utils'
import {
  evaluarFilas, aplicarImportacion,
  type FilaAspel, type FilaEvaluada, type ResumenImportacion,
} from './acciones'

type Campo = 'codigo_barras' | 'clave' | 'descripcion' | 'precio' | 'laboratorio'

const CAMPOS: { campo: Campo; label: string; ayuda: string; pistas: string[] }[] = [
  { campo: 'codigo_barras', label: 'Código de barras', ayuda: 'Lo que va a leer la pistola del POS.', pistas: ['ean', 'barras', 'gtin', 'upc', 'codigo de barras', 'cod barras'] },
  { campo: 'descripcion',   label: 'Descripción',      ayuda: 'El nombre del producto.',              pistas: ['descr', 'descripcion', 'nombre', 'producto', 'articulo'] },
  { campo: 'clave',         label: 'Clave / SKU',      ayuda: 'La clave interna de Aspel.',           pistas: ['cve_art', 'cve', 'clave', 'sku', 'codigo', 'cod'] },
  { campo: 'precio',        label: 'Precio de venta',  ayuda: 'Opcional.',                            pistas: ['precio', 'pventa', 'precio1', 'venta', 'importe'] },
  { campo: 'laboratorio',   label: 'Laboratorio',      ayuda: 'Opcional.',                            pistas: ['laboratorio', 'lab', 'marca', 'linea', 'fabricante'] },
]

const norm = (s: string) =>
  s.toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

function adivinar(headers: string[]): Record<Campo, string> {
  const mapa = {} as Record<Campo, string>
  const usados = new Set<string>()
  for (const { campo, pistas } of CAMPOS) {
    for (const h of headers) {
      if (usados.has(h)) continue
      const hn = norm(h)
      if (pistas.some(p => hn === p || hn.includes(p))) {
        mapa[campo] = h
        usados.add(h)
        break
      }
    }
    if (!mapa[campo]) mapa[campo] = ''
  }
  return mapa
}

const numero = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const n = parseFloat(String(v).replace(/[^0-9.,-]/g, '').replace(/,/g, ''))
  return Number.isNaN(n) ? null : n
}

const texto = (v: unknown): string | null => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

const COLOR_MATCH: Record<string, string> = {
  codigo:  'bg-emerald-100 text-emerald-800',
  nombre:  'bg-blue-100 text-blue-800',
  nuevo:   'bg-amber-100 text-amber-800',
  ambiguo: 'bg-red-100 text-red-800',
}

const LABEL_MATCH: Record<string, string> = {
  codigo:  'Se actualiza',
  nombre:  'Se actualiza (por nombre)',
  nuevo:   'Se crea nuevo',
  ambiguo: 'Revisar a mano',
}

export default function ImportadorAspel() {
  const [headers, setHeaders] = useState<string[]>([])
  const [crudas, setCrudas] = useState<Record<string, unknown>[]>([])
  const [mapa, setMapa] = useState<Record<Campo, string>>({} as Record<Campo, string>)
  const [evaluadas, setEvaluadas] = useState<FilaEvaluada[] | null>(null)
  const [avance, setAvance] = useState<{ hechas: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resumen, setResumen] = useState<ResumenImportacion | null>(null)
  const [aplicando, startAplicar] = useTransition()

  const [actualizarCodigos, setActualizarCodigos] = useState(true)
  const [actualizarPrecios, setActualizarPrecios] = useState(false)
  const [crearNuevos, setCrearNuevos] = useState(false)

  // --- Leer el archivo -------------------------------------------------

  const leer = async (file: File) => {
    setError(null); setEvaluadas(null); setResumen(null); setAvance(null)
    try {
      const buffer = await file.arrayBuffer()
      const libro = XLSX.read(buffer, { cellDates: true })
      const hoja = libro.Sheets[libro.SheetNames[0]]
      if (!hoja) { setError('El archivo no tiene ninguna hoja con datos.'); return }

      const filas = XLSX.utils.sheet_to_json<Record<string, unknown>>(hoja, { defval: null })
      if (!filas.length) { setError('La primera hoja está vacía.'); return }

      const cols = Object.keys(filas[0])
      setHeaders(cols)
      setCrudas(filas)
      setMapa(adivinar(cols))
    } catch {
      setError('No se pudo leer el archivo. Debe ser .xlsx, .xls o .csv exportado de Aspel.')
    }
  }

  const filasMapeadas: FilaAspel[] = useMemo(() => crudas.map(r => ({
    codigo_barras: mapa.codigo_barras ? texto(r[mapa.codigo_barras]) : null,
    clave:         mapa.clave         ? texto(r[mapa.clave])         : null,
    descripcion:   mapa.descripcion   ? texto(r[mapa.descripcion])   : null,
    precio:        mapa.precio        ? numero(r[mapa.precio])       : null,
    laboratorio:   mapa.laboratorio   ? texto(r[mapa.laboratorio])   : null,
  })), [crudas, mapa])

  // --- Vista previa ----------------------------------------------------

  const evaluar = async () => {
    setError(null); setResumen(null)
    if (!mapa.descripcion && !mapa.codigo_barras) {
      setError('Indica al menos qué columna trae la descripción o el código de barras.')
      return
    }

    const acumulado: FilaEvaluada[] = []
    const TANDA = 100
    setAvance({ hechas: 0, total: filasMapeadas.length })

    for (let i = 0; i < filasMapeadas.length; i += TANDA) {
      const tanda = filasMapeadas.slice(i, i + TANDA)
      const r = await evaluarFilas(tanda)
      if (r.error) { setError(r.error); setAvance(null); return }
      // El índice que devuelve la acción es relativo a la tanda; se corrige
      // para que el número de fila del aviso sea el del archivo.
      acumulado.push(...r.evaluadas.map(f => ({ ...f, indice: f.indice + i })))
      setAvance({ hechas: Math.min(i + TANDA, filasMapeadas.length), total: filasMapeadas.length })
    }

    setEvaluadas(acumulado)
    setAvance(null)
  }

  const conteos = useMemo(() => {
    const c = { codigo: 0, nombre: 0, nuevo: 0, ambiguo: 0 }
    for (const f of evaluadas ?? []) c[f.match]++
    return c
  }, [evaluadas])

  const aplicar = () => {
    if (!evaluadas) return
    setError(null)
    startAplicar(async () => {
      const r = await aplicarImportacion(evaluadas, { actualizarCodigos, actualizarPrecios, crearNuevos })
      if (!r.ok) { setError(r.error); return }
      setResumen(r.resumen)
    })
  }

  const tarjeta = 'bg-white border border-gray-200 rounded-xl'
  const select = 'w-full px-3 py-2.5 text-base border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-[#003366]'

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
              <strong>{resumen.actualizados}</strong> productos actualizados
              {resumen.creados > 0 && <> · <strong>{resumen.creados}</strong> creados</>}
              {resumen.omitidos > 0 && <> · {resumen.omitidos} omitidos</>}.
              <p className="mt-1 text-sm text-emerald-800">
                Las existencias no se tocaron: esas entran por movimientos de inventario.
              </p>
            </div>
          </div>
          {resumen.errores.length > 0 && (
            <ul className="mt-3 text-sm text-red-700 list-disc list-inside space-y-0.5">
              {resumen.errores.slice(0, 10).map((e, i) => <li key={i}>{e}</li>)}
              {resumen.errores.length > 10 && <li>y {resumen.errores.length - 10} más</li>}
            </ul>
          )}
        </div>
      )}

      {/* 1 · Archivo */}
      <div className={`${tarjeta} p-5`}>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">1 · Sube la exportación de Aspel</h2>
        <p className="text-base text-gray-500 mb-4">
          Excel (.xlsx, .xls) o CSV. En Aspel SAE: <em>Inventarios → Catálogo de productos →
          Exportar</em>. Lo importante es que venga la columna del código de barras.
        </p>
        <label className="inline-flex items-center gap-2 px-5 py-3 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-[#003366]/40 transition-colors text-base font-medium text-gray-700">
          <ArrowUpTrayIcon className="w-5 h-5 text-gray-400" />
          {crudas.length ? `${crudas.length} filas cargadas · cambiar archivo` : 'Elegir archivo'}
          <input
            type="file" accept=".xlsx,.xls,.csv" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) leer(f); e.target.value = '' }}
          />
        </label>
      </div>

      {/* 2 · Mapeo */}
      {headers.length > 0 && (
        <div className={`${tarjeta} p-5`}>
          <h2 className="text-lg font-semibold text-gray-900 mb-1">2 · Di qué es cada columna</h2>
          <p className="text-base text-gray-500 mb-4">
            Se adivinaron por el encabezado. Corrige lo que haga falta.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {CAMPOS.map(({ campo, label, ayuda }) => (
              <div key={campo}>
                <label className="block text-sm font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                  {label}
                </label>
                <select
                  value={mapa[campo] ?? ''}
                  onChange={e => setMapa(m => ({ ...m, [campo]: e.target.value }))}
                  className={select}
                >
                  <option value="">— no está en el archivo —</option>
                  {headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
                <p className="text-sm text-gray-400 mt-1">{ayuda}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              onClick={evaluar}
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
        </div>
      )}

      {/* 3 · Vista previa */}
      {evaluadas && (
        <div className={tarjeta}>
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900">3 · Qué va a pasar</h2>
            <div className="flex flex-wrap gap-2 mt-3">
              {(['codigo', 'nombre', 'nuevo', 'ambiguo'] as const).map(k => (
                <span key={k} className={`text-sm font-medium px-3 py-1.5 rounded-full ${COLOR_MATCH[k]}`}>
                  {conteos[k]} · {LABEL_MATCH[k]}
                </span>
              ))}
            </div>
          </div>

          <div className="px-5 py-4 border-b border-gray-100 space-y-2.5">
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={actualizarCodigos}
                onChange={e => setActualizarCodigos(e.target.checked)}
                className="w-5 h-5 mt-0.5 rounded border-gray-300 text-[#003366]" />
              <span className="text-base text-gray-700">
                Actualizar el <strong>código de barras</strong> de los que ya existen
                <span className="block text-sm text-gray-500">Es lo que hace funcionar el escaneo del POS.</span>
              </span>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={actualizarPrecios}
                onChange={e => setActualizarPrecios(e.target.checked)}
                className="w-5 h-5 mt-0.5 rounded border-gray-300 text-[#003366]" />
              <span className="text-base text-gray-700">
                Actualizar también el <strong>precio de venta</strong>
                <span className="block text-sm text-gray-500">Pisa el precio que ya tenga el catálogo.</span>
              </span>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={crearNuevos}
                onChange={e => setCrearNuevos(e.target.checked)}
                className="w-5 h-5 mt-0.5 rounded border-gray-300 text-[#003366]" />
              <span className="text-base text-gray-700">
                Dar de alta los <strong>{conteos.nuevo} productos nuevos</strong>
                <span className="block text-sm text-gray-500">
                  Entran sin existencia. Se cargan con una compra o un movimiento de entrada.
                </span>
              </span>
            </label>
          </div>

          <div className="overflow-x-auto max-h-[60vh]">
            <table className="w-full text-base min-w-[880px]">
              <thead className="sticky top-0 bg-gray-50">
                <tr className="border-b border-gray-100">
                  <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">#</th>
                  <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Del archivo</th>
                  <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Código</th>
                  <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">En el catálogo</th>
                  <th className="text-right px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Precio</th>
                  <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {evaluadas.slice(0, 300).map(f => (
                  <tr key={f.indice} className={f.match === 'ambiguo' ? 'bg-red-50/40' : undefined}>
                    <td className="px-5 py-3 text-sm text-gray-400">{f.indice + 2}</td>
                    <td className="px-5 py-3">
                      <div className="text-gray-900">{f.descripcion ?? '—'}</div>
                      {f.nota && <div className="text-sm text-amber-700 mt-0.5">{f.nota}</div>}
                    </td>
                    <td className="px-5 py-3 font-mono text-sm text-gray-600">{f.codigo_barras ?? '—'}</td>
                    <td className="px-5 py-3 text-gray-600">
                      {f.producto_nombre ?? <span className="text-gray-300">—</span>}
                      {f.score !== null && (
                        <span className="text-sm text-gray-400"> ({Math.round(f.score * 100)}%)</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right text-gray-600 whitespace-nowrap">
                      {f.precio !== null ? pesos(f.precio) : '—'}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-sm font-medium px-2.5 py-1 rounded-md whitespace-nowrap ${COLOR_MATCH[f.match]}`}>
                        {LABEL_MATCH[f.match]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {evaluadas.length > 300 && (
              <p className="px-5 py-3 text-sm text-gray-400 border-t border-gray-100">
                Se muestran las primeras 300 de {evaluadas.length}. Se aplican todas.
              </p>
            )}
          </div>

          <div className="px-5 py-4 bg-gray-50 border-t border-gray-200">
            <button
              onClick={aplicar}
              disabled={aplicando || (!actualizarCodigos && !actualizarPrecios && !crearNuevos)}
              className="w-full sm:w-auto px-6 py-3.5 bg-[#003366] text-white text-base font-semibold rounded-lg hover:bg-[#002244] disabled:opacity-50 transition-colors"
            >
              {aplicando ? 'Aplicando…' : 'Aplicar la importación'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
