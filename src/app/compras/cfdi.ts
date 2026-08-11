// Lector de facturas del proveedor (minuta 29).
//
// El "lector" honesto es el XML del CFDI: ya viene estructurado y exacto, no
// hace falta OCR ni adivinar nada. El PDF escaneado se queda fuera a
// propósito; el XML es el que trae la verdad fiscal.
//
// Sin dependencias: se parsea con expresiones regulares sobre el texto. En el
// servidor de Node no hay DOMParser y no vale la pena agregar una librería
// sólo para leer un puñado de atributos.
//
// Contempla:
//   · CFDI 4.0 y 3.3 (y de pasada 3.2, cuyos atributos van en minúscula).
//   · Atributos en cualquier orden, con comillas simples o dobles.
//   · XML con o sin declaración `<?xml ...?>`, con o sin comentarios.
//   · Prefijo de namespace variable: `cfdi:Comprobante`, `Comprobante`,
//     `c:Comprobante`... se compara siempre el nombre local.
//
// Está escrito a la defensiva: un atributo faltante devuelve null o 0, nunca
// revienta. Lo único que lanza Error es que el archivo no sea un CFDI,
// porque ahí no hay nada que precargar.

/** Un renglón de la factura: lo que el proveedor dice que está vendiendo. */
export interface CfdiConcepto {
  clave_prod_serv: string | null
  /** Clave del proveedor. Muy seguido ES el código de barras (minuta 22). */
  no_identificacion: string | null
  descripcion: string
  cantidad: number
  unidad: string | null
  valor_unitario: number
  importe: number
  descuento: number
  /** Clave del impuesto trasladado: '002' es IVA. */
  impuesto: string | null
  /** 'Tasa' | 'Cuota' | 'Exento' */
  tipo_factor: string | null
  /** TasaOCuota ya normalizada: 0.16, 0, ... Sólo cuando es una tasa. */
  tasa_iva: number
  /** Importe del impuesto trasladado de este renglón. */
  iva_trasladado: number
}

/** La factura completa, lista para precargar el formulario de compra. */
export interface CfdiParseado {
  version: string | null
  serie: string | null
  folio: string | null
  /** Fecha tal como viene: '2026-08-11T10:22:33'. */
  fecha: string | null
  /** Sólo el día, 'YYYY-MM-DD', que es lo que guarda `compras.fecha`. */
  fecha_dia: string | null
  subtotal: number
  descuento: number
  total: number
  moneda: string
  emisor_rfc: string | null
  emisor_nombre: string | null
  receptor_rfc: string | null
  receptor_nombre: string | null
  /** Folio fiscal del timbre. Es el identificador único de la factura. */
  uuid: string | null
  conceptos: CfdiConcepto[]
}

// Un tag completo: <pre:Nombre attr="v" ... /> o </pre:Nombre>.
// El bloque de atributos sólo admite valores entrecomillados, así que un '>'
// dentro de un atributo no corta el tag por accidente.
const RE_TAG =
  /<(\/?)([A-Za-z_][\w.\-]*(?::[A-Za-z_][\w.\-]*)?)((?:\s+[\w:.\-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g

const RE_ATTR = /([\w:.\-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

/** Nombre sin prefijo de namespace: 'cfdi:Concepto' -> 'concepto'. */
function nombreLocal(tag: string): string {
  const i = tag.indexOf(':')
  return (i === -1 ? tag : tag.slice(i + 1)).toLowerCase()
}

function caracter(codigo: number): string {
  if (!Number.isFinite(codigo) || codigo < 0 || codigo > 0x10ffff) return ''
  try {
    return String.fromCodePoint(codigo)
  } catch {
    return ''
  }
}

/** Entidades XML. `&amp;` se resuelve al final para no reintroducir otras. */
function desescapar(valor: string): string {
  if (!valor.includes('&')) return valor
  return valor
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => caracter(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => caracter(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
}

// Los atributos se guardan con la llave en minúscula para poder leerlos sin
// importar si el emisor mandó `ValorUnitario` (3.3/4.0) o `valorUnitario` (3.2).
type Atributos = Record<string, string>

function atributos(bloque: string): Atributos {
  const salida: Atributos = {}
  if (!bloque) return salida
  RE_ATTR.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = RE_ATTR.exec(bloque)) !== null) {
    salida[nombreLocal(m[1])] = desescapar(m[2] !== undefined ? m[2] : (m[3] ?? ''))
  }
  return salida
}

function texto(a: Atributos, clave: string): string | null {
  const v = a[clave.toLowerCase()]
  if (v === undefined) return null
  const limpio = v.trim()
  return limpio === '' ? null : limpio
}

function numero(a: Atributos, clave: string, porDefecto = 0): number {
  const v = a[clave.toLowerCase()]
  if (v === undefined) return porDefecto
  // Se tolera "1,234.56" y espacios: hay emisores que los mandan así.
  const n = Number(v.replace(/[^\d.\-+eE]/g, ''))
  return Number.isFinite(n) ? n : porDefecto
}

function conceptoDesde(a: Atributos): CfdiConcepto {
  const cantidad = numero(a, 'Cantidad', 0)
  const valorUnitario = numero(a, 'ValorUnitario', 0)
  const importe = numero(a, 'Importe', 0)

  // Si falta uno de los tres, se deduce del otro par. Un renglón sin cantidad
  // no sirve para dar entrada, así que en el peor caso queda en 1 y el
  // operador lo corrige antes de guardar.
  const cantidadFinal = cantidad > 0
    ? cantidad
    : (valorUnitario > 0 && importe > 0 ? importe / valorUnitario : 1)

  const valorFinal = valorUnitario > 0
    ? valorUnitario
    : (cantidadFinal > 0 ? importe / cantidadFinal : 0)

  return {
    clave_prod_serv: texto(a, 'ClaveProdServ'),
    no_identificacion: texto(a, 'NoIdentificacion'),
    descripcion: texto(a, 'Descripcion') ?? 'Sin descripción',
    cantidad: cantidadFinal,
    unidad: texto(a, 'Unidad') ?? texto(a, 'ClaveUnidad'),
    valor_unitario: valorFinal,
    importe: importe > 0 ? importe : cantidadFinal * valorFinal,
    descuento: numero(a, 'Descuento', 0),
    impuesto: null,
    tipo_factor: null,
    tasa_iva: 0,
    iva_trasladado: 0,
  }
}

/** Traslado de un concepto. El IVA es el impuesto '002'; el resto se ignora. */
function aplicarTraslado(c: CfdiConcepto, a: Atributos): void {
  const impuesto = texto(a, 'Impuesto')
  if (impuesto !== null && impuesto !== '002') return

  const tipoFactor = texto(a, 'TipoFactor')
  c.impuesto = impuesto ?? c.impuesto ?? '002'
  c.tipo_factor = tipoFactor ?? c.tipo_factor
  c.iva_trasladado = numero(a, 'Importe', 0)

  // 'Cuota' es un monto por unidad, no una tasa: no se puede guardar en
  // `tasa_iva`. 'Exento' es 0 y no es lo mismo que tasa 0%, pero para el
  // costo de la compra da igual.
  if (tipoFactor === 'Cuota' || tipoFactor === 'Exento') {
    c.tasa_iva = 0
    return
  }
  let tasa = numero(a, 'TasaOCuota', 0)
  // Hay emisores que mandan "16.00" en vez de "0.160000".
  if (tasa > 1) tasa = tasa / 100
  c.tasa_iva = tasa
}

function soloDia(fecha: string | null): string | null {
  if (!fecha) return null
  const dia = fecha.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(dia) ? dia : null
}

/**
 * Lee el XML de un CFDI y devuelve sus datos. Lanza Error, en español, si el
 * archivo no es un CFDI.
 */
export function parsearCFDI(xml: string): CfdiParseado {
  const fuente = typeof xml === 'string' ? xml : ''
  if (!fuente.trim()) {
    throw new Error('El archivo está vacío: no se encontró ningún XML que leer.')
  }

  // Los comentarios se quitan primero para que no aporten tags falsos.
  const limpio = fuente.replace(/<!--[\s\S]*?-->/g, '')

  let comprobante: Atributos | null = null
  let emisor: Atributos | null = null
  let receptor: Atributos | null = null
  let uuid: string | null = null

  const conceptos: CfdiConcepto[] = []
  // El concepto que se está leyendo: sus traslados vienen anidados debajo.
  let actual: CfdiConcepto | null = null

  const cerrarConcepto = () => {
    if (actual) {
      conceptos.push(actual)
      actual = null
    }
  }

  RE_TAG.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = RE_TAG.exec(limpio)) !== null) {
    const esCierre = m[1] === '/'
    const local = nombreLocal(m[2])

    if (esCierre) {
      if (local === 'concepto') cerrarConcepto()
      else if (local === 'conceptos') cerrarConcepto()
      continue
    }

    const a = atributos(m[3])
    const autocerrado = m[4] === '/'

    switch (local) {
      case 'comprobante':
        // El primero es el bueno: un complemento podría traer otro nodo igual.
        if (!comprobante) comprobante = a
        break
      case 'emisor':
        if (!emisor) emisor = a
        break
      case 'receptor':
        if (!receptor) receptor = a
        break
      case 'timbrefiscaldigital':
        if (!uuid) uuid = texto(a, 'UUID')
        break
      case 'concepto': {
        cerrarConcepto()
        const c = conceptoDesde(a)
        if (autocerrado) conceptos.push(c)
        else actual = c
        break
      }
      case 'traslado':
        // Sólo los traslados de DENTRO de un concepto. Los del pie del CFDI
        // (cfdi:Impuestos) ya vienen sumados y no dicen a qué renglón van.
        if (actual) aplicarTraslado(actual, a)
        break
      default:
        break
    }
  }
  // Por si el XML viene truncado y nunca cerró el último concepto.
  cerrarConcepto()

  if (!comprobante) {
    throw new Error(
      'El archivo no es un CFDI: no se encontró el nodo cfdi:Comprobante. ' +
      'Sube el XML de la factura, no el PDF.'
    )
  }

  const fecha = texto(comprobante, 'Fecha')

  return {
    version: texto(comprobante, 'Version'),
    serie: texto(comprobante, 'Serie'),
    folio: texto(comprobante, 'Folio'),
    fecha,
    fecha_dia: soloDia(fecha),
    subtotal: numero(comprobante, 'SubTotal', 0),
    descuento: numero(comprobante, 'Descuento', 0),
    total: numero(comprobante, 'Total', 0),
    moneda: texto(comprobante, 'Moneda') ?? 'MXN',
    emisor_rfc: emisor ? texto(emisor, 'Rfc') : null,
    emisor_nombre: emisor ? texto(emisor, 'Nombre') : null,
    receptor_rfc: receptor ? texto(receptor, 'Rfc') : null,
    receptor_nombre: receptor ? texto(receptor, 'Nombre') : null,
    uuid,
    conceptos,
  }
}
