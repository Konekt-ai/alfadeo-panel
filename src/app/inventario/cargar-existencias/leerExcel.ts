// Lee el Excel del conteo de almacén ("EXISTENCIAS EN ALMACEN POR ORDEN
// ALFABETICO").
//
// No es una tabla limpia y no se le puede pedir que lo sea: lo llena gente
// en el almacén. Lo que hay que aguantar:
//
//   · Arriba un título y una fecha, y los encabezados repetidos más abajo
//     (cada sección vuelve a poner CODIGO DE BARRAS, MARCA, PRODUCTO...).
//   · La sección de EQUIPO MÉDICO trae el nombre en la columna de la marca y
//     la de producto vacía.
//   · Piezas con notas pegadas: "49 (*)".
//   · Caducidad como fecha de Excel con formato mes-año ("may-26").
//   · Renglones copiados dos veces por error.
//
// Corre en el navegador: así se enseña la vista previa antes de mandar nada.

import * as XLSX from 'xlsx'

export interface FilaConteo {
  /** Renglón en el Excel, el mismo número que ve quien lo abre. */
  renglon: number
  codigo_barras: string | null
  marca: string | null
  nombre: string | null
  laboratorio: string | null
  lote: string | null
  /** 'YYYY-MM-DD'. */
  caducidad: string | null
  /** null = la celda viene vacía: todavía no se cuenta, no se carga. */
  piezas: number | null
  ubicacion: string | null
  avisos: string[]
  /** Si trae algo, el renglón no se carga. */
  error: string | null
  /** Copia de otro renglón (mismo producto, lote y ubicación): no se carga. */
  repetido_de: number | null
}

export interface HojaConteo {
  nombre: string
  filas: FilaConteo[]
}

type Columna =
  | 'codigo' | 'marca' | 'nombre' | 'laboratorio'
  | 'lote' | 'caducidad' | 'piezas' | 'ubicacion'

export const norm = (v: unknown) =>
  String(v ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** Un EAN/GTIN tiene de 8 a 14 dígitos. Lo demás no lo lee la pistola. */
export const esCodigoBarras = (s: string | null): boolean => !!s && /^\d{8,14}$/.test(s)

// El orden importa: un encabezado se asigna a la PRIMERA columna que lo
// reconozca. "EQUIPO MEDICO" ocupa el lugar del código en su sección.
const ES_COLUMNA: Record<Columna, (h: string) => boolean> = {
  codigo:      h => h.includes('codigo') || h.includes('equipo'),
  marca:       h => h === 'marca',
  nombre:      h => h === 'producto' || h === 'descripcion',
  laboratorio: h => h.startsWith('laboratorio'),
  lote:        h => h === 'lote',
  caducidad:   h => h.startsWith('caducidad'),
  piezas:      h => h === 'piezas' || h === 'existencia',
  ubicacion:   h => h.startsWith('ubicacion'),
}

type Mapa = Partial<Record<Columna, number>>

/** ¿Este renglón es un encabezado? Si sí, dice en qué columna va cada cosa. */
function leerEncabezado(celdas: unknown[]): Mapa | null {
  const mapa: Mapa = {}
  celdas.forEach((c, i) => {
    const h = norm(c)
    if (!h) return
    for (const col of Object.keys(ES_COLUMNA) as Columna[]) {
      if (mapa[col] === undefined && ES_COLUMNA[col](h)) { mapa[col] = i; break }
    }
  })
  if (mapa.lote === undefined || mapa.piezas === undefined) return null
  if (mapa.nombre === undefined && mapa.marca === undefined) return null
  // En EQUIPO MÉDICO la columna que sigue al código viene sin título, y ahí
  // es donde escriben el nombre.
  if (mapa.marca === undefined && mapa.codigo !== undefined) mapa.marca = mapa.codigo + 1
  return mapa
}

const texto = (v: unknown): string | null => {
  if (v === null || v === undefined) return null
  // Un código de barras capturado como número: toFixed evita el 7.5e+12.
  const s = typeof v === 'number' && Number.isInteger(v) ? v.toFixed(0) : String(v)
  const limpio = s.replace(/\s+/g, ' ').trim()
  return limpio === '' ? null : limpio
}

// ------------------------------------------------------------- caducidad --

const MESES: Record<string, number> = {
  ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7,
  ago: 8, aug: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12,
}

const dos = (n: number) => String(n).padStart(2, '0')
const ultimoDia = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const anio = (s: string) => (s.length === 2 ? 2000 + Number(s) : Number(s))

function fecha(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > ultimoDia(y, m)) return null
  return `${y}-${dos(m)}-${dos(d)}`
}

/**
 * Las cajas dicen "MAY-26": caducan al terminar ese mes. Por eso, cuando sólo
 * viene mes y año, se guarda el último día del mes.
 */
function leerCaducidad(v: unknown): { caducidad: string | null; aviso?: string } {
  if (v === null || v === undefined || v === '') return { caducidad: null }

  // Fecha de Excel: días desde el 30 de diciembre de 1899. Se cuenta en UTC
  // para que la zona horaria no le reste un día.
  if (typeof v === 'number' && v > 60) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86_400_000)
    const f = fecha(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
    if (f) return { caducidad: f }
  }

  const s = norm(v)
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  let f: string | null = null
  if (m) f = fecha(Number(m[1]), Number(m[2]), Number(m[3]))
  if (!f && (m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/)))
    f = fecha(anio(m[3]), Number(m[2]), Number(m[1]))
  if (!f && (m = s.match(/^([a-z]{3})[a-z]*\.?[\s/.-]*(\d{2}|\d{4})$/)) && MESES[m[1]]) {
    const y = anio(m[2])
    f = fecha(y, MESES[m[1]], ultimoDia(y, MESES[m[1]]))
  }
  if (!f && (m = s.match(/^(\d{1,2})[/.-](\d{4})$/)))
    f = fecha(Number(m[2]), Number(m[1]), ultimoDia(Number(m[2]), Number(m[1]) || 1))

  if (f) return { caducidad: f }
  return { caducidad: null, aviso: `No se entendió la caducidad «${String(v).trim()}»; entra sin caducidad.` }
}

// ---------------------------------------------------------------- piezas --

function leerPiezas(v: unknown): { piezas: number | null; aviso?: string; error?: string } {
  if (v === null || v === undefined || v === '') return { piezas: null }
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 0) return { piezas: null, error: `Piezas «${v}» no es válido.` }
    return { piezas: v }
  }
  const s = String(v).trim()
  if (!s) return { piezas: null }

  // "49 (*)": el número manda, la nota se avisa.
  const m = s.match(/^(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(.*)$/)
  if (!m) return { piezas: null, error: `Piezas «${s}» no es un número.` }
  const n = Number(m[1].replace(/,/g, ''))
  return { piezas: n, aviso: m[2].trim() ? `Traía «${s}»; se toman ${n} piezas.` : undefined }
}

// ------------------------------------------------------------------ hoja --

function leerHoja(hoja: XLSX.WorkSheet): FilaConteo[] {
  const crudas = XLSX.utils.sheet_to_json<unknown[]>(hoja, {
    header: 1, raw: true, defval: null, blankrows: true,
  })
  // sheet_to_json empieza donde empieza la hoja, que no siempre es A1.
  const inicio = XLSX.utils.decode_range(hoja['!ref'] ?? 'A1').s.r

  const filas: FilaConteo[] = []
  const vistos = new Map<string, number>()
  let mapa: Mapa | null = null

  crudas.forEach((celdas, i) => {
    const renglon = inicio + i + 1
    const fila = celdas ?? []
    const encabezado = leerEncabezado(fila)
    if (encabezado) { mapa = encabezado; return }
    if (!mapa) return

    const m: Mapa = mapa
    const celda = (c: Columna) => (m[c] === undefined ? null : fila[m[c]!])

    const lote = texto(celda('lote'))
    const ubicacion = texto(celda('ubicacion'))
    const crudasPiezas = celda('piezas')
    // Ni lote, ni ubicación, ni piezas: es un título o un renglón vacío.
    if (!lote && !ubicacion && texto(crudasPiezas) === null) return

    const columnaNombre = texto(celda('nombre'))
    const columnaMarca = texto(celda('marca'))
    const avisos: string[] = []
    let error: string | null = null

    let codigo = texto(celda('codigo'))
    if (codigo && !esCodigoBarras(codigo)) {
      avisos.push(`«${codigo}» no parece código de barras (son 8 a 14 dígitos); se busca por nombre.`)
      codigo = null
    }

    const cad = leerCaducidad(celda('caducidad'))
    if (cad.aviso) avisos.push(cad.aviso)

    const pz = leerPiezas(crudasPiezas)
    if (pz.aviso) avisos.push(pz.aviso)
    if (pz.error) error = pz.error

    const nombre = columnaNombre ?? columnaMarca
    if (!nombre && !codigo) error = error ?? 'No trae nombre ni código de barras.'

    // Mismo producto, lote y ubicación = el mismo renglón copiado. Se toma
    // el primero.
    const llave = [codigo ?? norm(nombre), norm(lote), norm(ubicacion)].join('|')
    const previo = vistos.get(llave)
    if (previo === undefined) vistos.set(llave, renglon)

    filas.push({
      renglon,
      codigo_barras: codigo,
      marca: columnaNombre ? columnaMarca : null,
      nombre,
      laboratorio: texto(celda('laboratorio')),
      lote,
      caducidad: cad.caducidad,
      piezas: pz.piezas,
      ubicacion: ubicacion?.toUpperCase() ?? null,
      avisos,
      error,
      repetido_de: previo ?? null,
    })
  })

  return filas
}

/** Todas las hojas que tienen al menos un renglón de inventario. */
export function leerLibro(datos: ArrayBuffer): HojaConteo[] {
  const libro = XLSX.read(datos)
  return libro.SheetNames
    .map(nombre => ({ nombre, filas: leerHoja(libro.Sheets[nombre]) }))
    .filter(h => h.filas.length > 0)
}
