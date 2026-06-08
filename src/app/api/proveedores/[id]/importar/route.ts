import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Normaliza un encabezado: minúsculas, sin acentos ni espacios extra.
function norm(s: string): string {
  return s
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita acentos combinantes
    .trim()
}

// Mapea las columnas del Excel a nuestros campos por palabras clave.
// Devuelve, para cada campo, el nombre de columna original que le corresponde.
const CAMPOS: Record<string, string[]> = {
  codigo_barras: ['ean', 'barras', 'gtin', 'upc', 'codigo de barras'],
  sku_proveedor: ['sku', 'clave', 'cve', 'codigo', 'cod', 'articulo', 'art'],
  nombre_prov: ['nombre', 'descripcion', 'producto', 'descripcio', 'desc'],
  laboratorio: ['laboratorio', 'lab', 'marca', 'fabricante'],
  presentacion: ['presentacion', 'present', 'empaque'],
  precio: ['precio', 'costo', 'importe', 'pventa', 'precio unitario'],
  existencia: ['existencia', 'stock', 'disponible', 'inventario', 'cantidad', 'cant'],
  caducidad: ['caducidad', 'cad', 'vence', 'vencimiento', 'expira', 'fecha cad'],
  moq: ['moq', 'minimo', 'min compra', 'pedido minimo'],
}

function mapearColumnas(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {}
  const usados = new Set<string>()
  for (const [campo, claves] of Object.entries(CAMPOS)) {
    for (const h of headers) {
      if (usados.has(h)) continue
      const hn = norm(h)
      if (claves.some(k => hn === k || hn.includes(k))) {
        map[campo] = h
        usados.add(h)
        break
      }
    }
  }
  return map
}

function parseNumero(v: any): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return v
  const n = parseFloat(String(v).replace(/[^0-9.,-]/g, '').replace(/,/g, ''))
  return isNaN(n) ? null : n
}

function parseFecha(v: any): string | null {
  if (v == null || v === '') return null
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: proveedor_id } = await params

  const form = await req.formData()
  const file = form.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No se recibió ningún archivo.' }, { status: 400 })

  // Confirmar que el proveedor existe.
  const { data: prov } = await supabase.from('proveedores').select('id').eq('id', proveedor_id).single()
  if (!prov) return NextResponse.json({ error: 'Proveedor no encontrado.' }, { status: 404 })

  let rows: Record<string, any>[]
  try {
    const buf = Buffer.from(await file.arrayBuffer())
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: true })
    const ws = wb.Sheets[wb.SheetNames[0]]
    rows = XLSX.utils.sheet_to_json(ws, { defval: null })
  } catch {
    return NextResponse.json({ error: 'No se pudo leer el archivo. ¿Es un Excel o CSV válido?' }, { status: 400 })
  }

  if (!rows.length) return NextResponse.json({ error: 'El archivo está vacío.' }, { status: 400 })

  const headers = Object.keys(rows[0])
  const map = mapearColumnas(headers)

  if (!map.nombre_prov && !map.sku_proveedor) {
    return NextResponse.json(
      { error: `No se encontró una columna de nombre/descripción ni de clave. Columnas detectadas: ${headers.join(', ')}` },
      { status: 400 }
    )
  }

  const ahora = new Date().toISOString()
  const registros: any[] = []
  let omitidas = 0

  for (const r of rows) {
    const nombre_prov = map.nombre_prov ? String(r[map.nombre_prov] ?? '').trim() : ''
    let sku = map.sku_proveedor ? String(r[map.sku_proveedor] ?? '').trim() : ''
    // Si no hay nombre ni sku, la fila no sirve.
    if (!nombre_prov && !sku) { omitidas++; continue }
    // La clave de upsert no puede ser nula: usa el nombre como respaldo.
    if (!sku) sku = nombre_prov.slice(0, 200)

    const existencia = map.existencia ? parseNumero(r[map.existencia]) : null

    registros.push({
      proveedor_id,
      sku_proveedor: sku,
      codigo_barras: map.codigo_barras ? String(r[map.codigo_barras] ?? '').trim() || null : null,
      nombre_prov: nombre_prov || sku,
      laboratorio: map.laboratorio ? String(r[map.laboratorio] ?? '').trim() || null : null,
      presentacion: map.presentacion ? String(r[map.presentacion] ?? '').trim() || null : null,
      precio: map.precio ? parseNumero(r[map.precio]) : null,
      existencia,
      en_stock: existencia == null ? null : existencia > 0,
      caducidad: map.caducidad ? parseFecha(r[map.caducidad]) : null,
      moq: map.moq ? parseNumero(r[map.moq]) : null,
      origen: 'import',
      fecha_precio: ahora,
      // OJO: no incluimos producto_id ni match_estado → así un re-import
      // NO borra los emparejamientos ya confirmados (upsert solo toca estas columnas).
    })
  }

  if (!registros.length) {
    return NextResponse.json({ error: 'Ninguna fila tenía datos aprovechables.' }, { status: 400 })
  }

  // Upsert por (proveedor_id, sku_proveedor). En lotes para archivos grandes.
  let insertados = 0
  for (let i = 0; i < registros.length; i += 500) {
    const lote = registros.slice(i, i + 500)
    const { error } = await supabase
      .from('proveedor_precios')
      .upsert(lote, { onConflict: 'proveedor_id,sku_proveedor' })
    if (error) {
      return NextResponse.json(
        { error: `Error al guardar (fila ~${i}): ${error.message}`, insertados },
        { status: 500 }
      )
    }
    insertados += lote.length
  }

  return NextResponse.json({
    ok: true,
    insertados,
    omitidas,
    columnas_detectadas: map,
  })
}
