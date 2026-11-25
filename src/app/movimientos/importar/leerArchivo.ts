// Lee el archivo de entradas y salidas: un Excel con el formato del panel o
// el XML de una factura (CFDI).
//
// Corre en el navegador para enseñar la vista previa antes de mandar nada.
// Las piezas finas (caducidad "may-26", piezas "49 (*)", códigos capturados
// como número) son las mismas del conteo de inventario: se reusan de ahí.

import * as XLSX from 'xlsx'
import {
  norm, esCodigoBarras, texto, leerCaducidad, leerPiezas,
} from '../../inventario/cargar-existencias/leerExcel'
import { parsearCFDI } from '../../compras/cfdi'

export type TipoMov = 'entrada' | 'salida'

export interface FilaMov {
  /** Renglón del Excel, o número de concepto en el XML. */
  renglon: number
  /** null = el archivo no trae columna TIPO: se usa el que se elija al subir. */
  tipo: TipoMov | null
  codigo_barras: string | null
  marca: string | null
  nombre: string | null
  lote: string | null
  /** 'YYYY-MM-DD'. */
  caducidad: string | null
  cantidad: number | null
  ubicacion: string | null
  costo: number | null
  motivo: string | null
  avisos: string[]
  /** Si trae algo, el renglón no se carga. */
  error: string | null
  /** Copia exacta de otro renglón: no se carga dos veces. */
  repetido_de: number | null
}

export interface DatosCfdi {
  uuid: string | null
  serie: string | null
  folio: string | null
  fecha: string | null
  emisor_rfc: string | null
  emisor_nombre: string | null
  receptor_rfc: string | null
  receptor_nombre: string | null
  total: number
}

export interface ArchivoMov {
  tipo: 'excel' | 'xml'
  /** Hojas del Excel que tienen el encabezado del formato. En XML, una. */
  hojas: { nombre: string; filas: FilaMov[]; conTipo: boolean }[]
  cfdi: DatosCfdi | null
}

// ------------------------------------------------------------------ Excel --

type Columna =
  | 'tipo' | 'codigo' | 'marca' | 'nombre' | 'lote' | 'caducidad'
  | 'cantidad' | 'ubicacion' | 'costo' | 'motivo'

// Se aceptan los nombres del formato y los parecidos que se usan en la
// oficina (PIEZAS por CANTIDAD, DESCRIPCION por PRODUCTO...).
const ES_COLUMNA: Record<Columna, (h: string) => boolean> = {
  tipo:      h => h === 'tipo' || h.startsWith('movimiento') || h === 'entrada/salida',
  codigo:    h => h.includes('codigo') || h === 'ean' || h === 'barras',
  marca:     h => h === 'marca' || h === 'nombre comercial',
  nombre:    h => h === 'producto' || h === 'descripcion' || h === 'nombre',
  lote:      h => h === 'lote',
  caducidad: h => h.startsWith('caducidad'),
  cantidad:  h => h === 'cantidad' || h === 'piezas',
  ubicacion: h => h.startsWith('ubicacion'),
  costo:     h => h.startsWith('costo'),
  motivo:    h => h === 'motivo' || h.startsWith('referencia') || h.startsWith('observacion') || h === 'notas',
}

type Mapa = Partial<Record<Columna, number>>

function leerEncabezado(celdas: unknown[]): Mapa | null {
  const mapa: Mapa = {}
  celdas.forEach((c, i) => {
    const h = norm(c)
    if (!h) return
    for (const col of Object.keys(ES_COLUMNA) as Columna[]) {
      if (mapa[col] === undefined && ES_COLUMNA[col](h)) { mapa[col] = i; break }
    }
  })
  if (mapa.cantidad === undefined) return null
  if (mapa.codigo === undefined && mapa.nombre === undefined) return null
  return mapa
}

const ENTRADA = ['entrada', 'e', 'ent', '+', 'alta', 'compra', 'recepcion']
const SALIDA = ['salida', 's', 'sal', '-', 'baja', 'venta', 'surtido']

function leerTipo(v: unknown): { tipo: TipoMov | null; error?: string } {
  const t = norm(v)
  if (!t) return { tipo: null }
  if (ENTRADA.includes(t)) return { tipo: 'entrada' }
  if (SALIDA.includes(t)) return { tipo: 'salida' }
  return { tipo: null, error: `Tipo «${String(v).trim()}» no se entiende: usa ENTRADA o SALIDA.` }
}

function leerCosto(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''))
  return Number.isFinite(n) && n >= 0 ? n : null
}

function leerHoja(hoja: XLSX.WorkSheet): { filas: FilaMov[]; conTipo: boolean } {
  const crudas = XLSX.utils.sheet_to_json<unknown[]>(hoja, {
    header: 1, raw: true, defval: null, blankrows: true,
  })
  const inicio = XLSX.utils.decode_range(hoja['!ref'] ?? 'A1').s.r

  const filas: FilaMov[] = []
  const vistos = new Map<string, number>()
  let mapa: Mapa | null = null
  let conTipo = false

  crudas.forEach((celdas, i) => {
    const renglon = inicio + i + 1
    const fila = celdas ?? []
    const encabezado = leerEncabezado(fila)
    if (encabezado) { mapa = encabezado; conTipo = conTipo || encabezado.tipo !== undefined; return }
    if (!mapa) return

    const m: Mapa = mapa
    const celda = (c: Columna) => (m[c] === undefined ? null : fila[m[c]!])

    const columnaNombre = texto(celda('nombre'))
    const columnaMarca = texto(celda('marca'))
    let codigo = texto(celda('codigo'))
    const crudaCantidad = celda('cantidad')
    // Renglón vacío o de título: ni producto ni cantidad.
    if (!codigo && !columnaNombre && !columnaMarca && texto(crudaCantidad) === null) return

    const avisos: string[] = []
    let error: string | null = null

    const tp = leerTipo(celda('tipo'))
    if (tp.error) error = tp.error

    if (codigo && !esCodigoBarras(codigo)) {
      avisos.push(`«${codigo}» no parece código de barras (son 8 a 14 dígitos); se busca por nombre.`)
      codigo = null
    }

    const cad = leerCaducidad(celda('caducidad'))
    if (cad.aviso) avisos.push(cad.aviso)

    const pz = leerPiezas(crudaCantidad)
    let tipo = tp.tipo
    let cantidad = pz.piezas
    if (pz.aviso) avisos.push(pz.aviso)
    if (pz.error) {
      // "-5" sin columna de tipo es una salida de 5: así lo anotan a mano.
      const n = Number(String(crudaCantidad ?? '').replace(/\s/g, ''))
      if (Number.isFinite(n) && n < 0 && !tipo) { tipo = 'salida'; cantidad = -n }
      else error = error ?? pz.error
    }
    if (!error && (cantidad === null || cantidad <= 0)) {
      error = cantidad === null ? 'Falta la cantidad.' : 'La cantidad tiene que ser mayor que cero.'
    }

    const nombre = columnaNombre ?? columnaMarca
    if (!nombre && !codigo) error = error ?? 'No trae producto ni código de barras.'

    const lote = texto(celda('lote'))
    const ubicacion = texto(celda('ubicacion'))?.toUpperCase() ?? null

    // El mismo renglón copiado dos veces: se toma una sola vez.
    const llave = [tipo ?? '', codigo ?? norm(nombre), norm(lote), norm(ubicacion), cantidad ?? ''].join('|')
    const previo = vistos.get(llave)
    if (previo === undefined) vistos.set(llave, renglon)

    filas.push({
      renglon,
      tipo,
      codigo_barras: codigo,
      marca: columnaNombre ? columnaMarca : null,
      nombre,
      lote,
      caducidad: cad.caducidad,
      cantidad,
      ubicacion,
      costo: leerCosto(celda('costo')),
      motivo: texto(celda('motivo')),
      avisos,
      error,
      repetido_de: previo ?? null,
    })
  })

  return { filas, conTipo }
}

// -------------------------------------------------------------------- XML --

/**
 * Los conceptos de la factura se vuelven renglones. La factura no trae lote
 * ni ubicación: la entrada queda sin lote y la salida sale por el lote que
 * caduca primero. El tipo lo decide quién la emitió: si la emitió alguna de
 * las razones sociales de la empresa es salida; si no, es de un proveedor y
 * es entrada.
 */
function leerXml(xml: string, rfcsPropios: string[]): ArchivoMov {
  const cfdi = parsearCFDI(xml)
  const propios = rfcsPropios.map(r => r.trim().toUpperCase()).filter(Boolean)
  const emisor = (cfdi.emisor_rfc ?? '').toUpperCase()
  const tipo: TipoMov | null = !emisor || propios.length === 0
    ? null
    : propios.includes(emisor) ? 'salida' : 'entrada'
  const referencia = [cfdi.serie, cfdi.folio].filter(Boolean).join('-')

  const filas: FilaMov[] = cfdi.conceptos.map((c, i) => {
    const avisos: string[] = []
    let codigo = c.no_identificacion
    if (codigo && !esCodigoBarras(codigo)) {
      avisos.push(`La clave «${codigo}» no es código de barras; se busca por nombre.`)
      codigo = null
    }
    return {
      renglon: i + 1,
      tipo,
      codigo_barras: codigo,
      marca: null,
      nombre: c.descripcion,
      lote: null,
      caducidad: null,
      cantidad: c.cantidad,
      ubicacion: null,
      costo: c.valor_unitario || null,
      motivo: `Factura ${referencia || cfdi.uuid || ''}`.trim(),
      avisos,
      error: c.cantidad > 0 ? null : 'El concepto no trae cantidad.',
      repetido_de: null,
    }
  })

  return {
    tipo: 'xml',
    hojas: [{ nombre: 'Factura', filas, conTipo: tipo !== null }],
    cfdi: {
      uuid: cfdi.uuid, serie: cfdi.serie, folio: cfdi.folio, fecha: cfdi.fecha,
      emisor_rfc: cfdi.emisor_rfc, emisor_nombre: cfdi.emisor_nombre,
      receptor_rfc: cfdi.receptor_rfc, receptor_nombre: cfdi.receptor_nombre,
      total: cfdi.total,
    },
  }
}

// ---------------------------------------------------------------- entrada --

export async function leerArchivoMov(file: File, rfcsPropios: string[]): Promise<ArchivoMov> {
  if (/\.xml$/i.test(file.name) || file.type.includes('xml')) {
    return leerXml(await file.text(), rfcsPropios)
  }
  const libro = XLSX.read(await file.arrayBuffer())
  const hojas = libro.SheetNames
    .map(nombre => ({ nombre, ...leerHoja(libro.Sheets[nombre]) }))
    .filter(h => h.filas.length > 0)
  return { tipo: 'excel', hojas, cfdi: null }
}

/**
 * La huella del archivo: la misma información da la misma huella aunque el
 * Excel se haya vuelto a guardar. Es lo que permite decir "este archivo ya
 * se aplicó" (punto 9). En una factura, la huella es su UUID.
 */
export async function huellaDe(archivo: ArchivoMov, filas: FilaMov[], plazaId: string): Promise<string> {
  if (archivo.cfdi?.uuid) return archivo.cfdi.uuid.toUpperCase()
  const contenido = JSON.stringify([
    plazaId,
    filas.map(f => [f.tipo, f.codigo_barras, norm(f.nombre), norm(f.lote), f.caducidad, f.cantidad, norm(f.ubicacion)]),
  ])
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(contenido))
  return Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16).toUpperCase()
}

/** La plantilla del formato, para descargar desde la pantalla. */
export function descargarPlantilla() {
  const datos = [
    ['TIPO', 'CODIGO DE BARRAS', 'PRODUCTO', 'LOTE', 'CADUCIDAD', 'CANTIDAD', 'UBICACION', 'COSTO', 'MOTIVO'],
    ['ENTRADA', '7502240450773', 'WERMY GABAPENTINA 300 mg C/15', '240837', 'jun-26', 30, 'RACK N2', 150, 'Compra factura F-5009'],
    ['SALIDA', '7502240450773', 'WERMY GABAPENTINA 300 mg C/15', '240837', '', 2, 'RACK N2', '', 'Pedido Hospital Ángeles'],
  ]
  const instrucciones = [
    ['Cómo llenar la plantilla'],
    ['TIPO: ENTRADA o SALIDA. Si se deja la columna fuera, al subir se elige si todo el archivo es entrada o salida.'],
    ['CODIGO DE BARRAS: el de la caja. Si no lo hay, el producto se busca por PRODUCTO.'],
    ['LOTE y UBICACION: en una salida, si van vacíos, sale primero lo que caduca antes.'],
    ['CADUCIDAD: fecha o mes-año (jun-26). Sólo hace falta en entradas de lote nuevo.'],
    ['CANTIDAD: piezas, siempre positiva. COSTO y MOTIVO son opcionales.'],
    ['El mismo archivo no se aplica dos veces: el panel lo reconoce aunque se vuelva a guardar.'],
  ]
  const libro = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(datos), 'Movimientos')
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(instrucciones), 'Instrucciones')
  XLSX.writeFile(libro, 'plantilla-entradas-salidas.xlsx')
}
