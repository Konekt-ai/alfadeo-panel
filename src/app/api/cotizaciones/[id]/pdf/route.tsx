import { supabase } from '@/lib/supabase'
import { NextResponse } from 'next/server'
import { renderToBuffer, Document, Page, View, Text, Image, StyleSheet, Font } from '@react-pdf/renderer'
import path from 'path'
import fs from 'fs'

const NAVY = '#003366'
const LIME = '#72B626'
const GRAY_BG = '#F8F9FA'
const GRAY_LINE = '#E9ECEF'
const TEXT_DARK = '#1A1A2E'
const TEXT_MID = '#555555'
const TEXT_LIGHT = '#888888'

const styles = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 9, color: TEXT_DARK, paddingTop: 48, paddingBottom: 60, paddingHorizontal: 48 },

  // Header
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 },
  logo: { width: 110, height: 36, objectFit: 'contain' },
  headerRight: { alignItems: 'flex-end' },
  folioLabel: { fontSize: 8, color: TEXT_LIGHT, marginBottom: 2 },
  folio: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: NAVY },
  headerMeta: { fontSize: 8, color: TEXT_MID, marginTop: 4 },

  divider: { height: 3, backgroundColor: NAVY, marginBottom: 2 },
  accentLine: { height: 1.5, backgroundColor: LIME, marginBottom: 20 },

  // Cliente + info
  twoCol: { flexDirection: 'row', gap: 16, marginBottom: 20 },
  card: { flex: 1, backgroundColor: GRAY_BG, borderRadius: 4, padding: 12 },
  cardTitle: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: NAVY, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8, borderBottom: `1px solid ${GRAY_LINE}`, paddingBottom: 4 },
  cardRow: { flexDirection: 'row', marginBottom: 4 },
  cardLabel: { fontSize: 8, color: TEXT_LIGHT, width: 70 },
  cardValue: { fontSize: 8, color: TEXT_DARK, flex: 1 },

  // Tabla
  tableHeader: { flexDirection: 'row', backgroundColor: NAVY, padding: '6 8', borderRadius: 3, marginBottom: 1 },
  tableRow: { flexDirection: 'row', padding: '5 8', borderBottom: `1px solid ${GRAY_LINE}` },
  tableRowAlt: { flexDirection: 'row', padding: '5 8', backgroundColor: GRAY_BG, borderBottom: `1px solid ${GRAY_LINE}` },
  colNum: { width: 24, fontSize: 8 },
  colDesc: { flex: 1, fontSize: 8 },
  colCant: { width: 48, fontSize: 8, textAlign: 'right' },
  colUnit: { width: 32, fontSize: 8, textAlign: 'center' },
  colPrecio: { width: 64, fontSize: 8, textAlign: 'right' },
  colSub: { width: 64, fontSize: 8, textAlign: 'right' },
  colIva: { width: 32, fontSize: 8, textAlign: 'center' },
  thText: { color: '#FFFFFF', fontFamily: 'Helvetica-Bold', fontSize: 7, textTransform: 'uppercase', letterSpacing: 0.5 },

  // Totales
  totalesRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 16 },
  totalesBox: { width: 200 },
  totalLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderBottom: `1px solid ${GRAY_LINE}` },
  totalLineTotal: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, backgroundColor: NAVY, paddingHorizontal: 8, borderRadius: 3, marginTop: 4 },
  totalLabel: { fontSize: 8, color: TEXT_MID },
  totalValue: { fontSize: 8, color: TEXT_DARK, fontFamily: 'Helvetica-Bold' },
  totalLabelBig: { fontSize: 9, color: '#FFFFFF', fontFamily: 'Helvetica-Bold' },
  totalValueBig: { fontSize: 10, color: '#FFFFFF', fontFamily: 'Helvetica-Bold' },

  // Condiciones
  condBox: { marginTop: 20, backgroundColor: GRAY_BG, borderRadius: 4, padding: 12, borderLeft: `3px solid ${LIME}` },
  condTitle: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: NAVY, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 },
  condText: { fontSize: 8, color: TEXT_MID, lineHeight: 1.5 },

  confirmBadge: { marginTop: 10, borderRadius: 3, border: `1px solid #FCD34D`, backgroundColor: '#FFFBEB', padding: '6 10' },
  confirmText: { fontSize: 8, color: '#92400E' },

  // Footer
  footer: { position: 'absolute', bottom: 28, left: 48, right: 48, flexDirection: 'row', justifyContent: 'space-between', borderTop: `1px solid ${GRAY_LINE}`, paddingTop: 8 },
  footerText: { fontSize: 7, color: TEXT_LIGHT },
  pageNum: { fontSize: 7, color: TEXT_LIGHT },
})

const fmt = (n: number) =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const { data: cot } = await supabase
    .from('cotizaciones')
    .select(`
      id, folio, estado, vigencia_dias, condiciones, notas,
      subtotal, iva, total, created_at,
      cotizacion_items ( descripcion, cantidad, unidad, precio_unitario, subtotal, iva_exento, sujeto_confirmacion, posicion ),
      solicitudes ( folio, clientes ( nombre, empresa, tipo, ciudad, correo, telefono_wa ) )
    `)
    .eq('id', params.id)
    .single()

  if (!cot) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const logoPath = path.join(process.cwd(), 'public', 'logo.png')
  const logoBase64 = `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`

  const sol = (cot.solicitudes as any)
  const cliente = sol?.clientes ?? {}
  const items = [...((cot.cotizacion_items as any[]) ?? [])].sort((a, b) => a.posicion - b.posicion)

  const fechaCot = new Date(cot.created_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })
  const fechaVence = new Date(
    new Date(cot.created_at).getTime() + cot.vigencia_dias * 86400000
  ).toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })

  const haySujetoConfirmacion = items.some((it: any) => it.sujeto_confirmacion)

  const pdf = await renderToBuffer(
    <Document title={`Cotización ${cot.folio}`} author="ALFA-DEO">
      <Page size="LETTER" style={styles.page}>

        {/* Header */}
        <View style={styles.headerRow}>
          <Image src={logoBase64} style={styles.logo} />
          <View style={styles.headerRight}>
            <Text style={styles.folioLabel}>COTIZACIÓN</Text>
            <Text style={styles.folio}>{cot.folio}</Text>
            <Text style={styles.headerMeta}>Fecha: {fechaCot}</Text>
            <Text style={styles.headerMeta}>Vigente hasta: {fechaVence}</Text>
          </View>
        </View>

        <View style={styles.divider} />
        <View style={styles.accentLine} />

        {/* Cliente + Solicitud */}
        <View style={styles.twoCol}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Datos del cliente</Text>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>Empresa</Text>
              <Text style={styles.cardValue}>{cliente.empresa ?? '—'}</Text>
            </View>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>Contacto</Text>
              <Text style={styles.cardValue}>{cliente.nombre ?? '—'}</Text>
            </View>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>Ciudad</Text>
              <Text style={styles.cardValue}>{cliente.ciudad ?? '—'}</Text>
            </View>
            {cliente.correo && (
              <View style={styles.cardRow}>
                <Text style={styles.cardLabel}>Correo</Text>
                <Text style={styles.cardValue}>{cliente.correo}</Text>
              </View>
            )}
            {cliente.telefono_wa && (
              <View style={styles.cardRow}>
                <Text style={styles.cardLabel}>WhatsApp</Text>
                <Text style={styles.cardValue}>{cliente.telefono_wa}</Text>
              </View>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Referencia</Text>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>Solicitud</Text>
              <Text style={styles.cardValue}>#{sol?.folio ?? '—'}</Text>
            </View>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>Vigencia</Text>
              <Text style={styles.cardValue}>{cot.vigencia_dias} días</Text>
            </View>
            <View style={styles.cardRow}>
              <Text style={styles.cardLabel}>Estado</Text>
              <Text style={styles.cardValue}>{cot.estado.charAt(0).toUpperCase() + cot.estado.slice(1)}</Text>
            </View>
          </View>
        </View>

        {/* Tabla */}
        <View style={styles.tableHeader}>
          <Text style={[styles.colNum, styles.thText]}>#</Text>
          <Text style={[styles.colDesc, styles.thText]}>Descripción</Text>
          <Text style={[styles.colCant, styles.thText]}>Cant.</Text>
          <Text style={[styles.colUnit, styles.thText]}>Unid.</Text>
          <Text style={[styles.colPrecio, styles.thText]}>P. Unit.</Text>
          <Text style={[styles.colIva, styles.thText]}>IVA</Text>
          <Text style={[styles.colSub, styles.thText]}>Subtotal</Text>
        </View>

        {items.map((it: any, i: number) => (
          <View key={i} style={i % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
            <Text style={styles.colNum}>{String(i + 1).padStart(2, '0')}</Text>
            <Text style={styles.colDesc}>{it.descripcion}{it.sujeto_confirmacion ? ' *' : ''}</Text>
            <Text style={styles.colCant}>{it.cantidad}</Text>
            <Text style={styles.colUnit}>{it.unidad ?? '—'}</Text>
            <Text style={styles.colPrecio}>{fmt(it.precio_unitario)}</Text>
            <Text style={styles.colIva}>{it.iva_exento ? 'Exento' : '16%'}</Text>
            <Text style={styles.colSub}>{fmt(it.subtotal)}</Text>
          </View>
        ))}

        {/* Totales */}
        <View style={styles.totalesRow}>
          <View style={styles.totalesBox}>
            <View style={styles.totalLine}>
              <Text style={styles.totalLabel}>Subtotal</Text>
              <Text style={styles.totalValue}>{fmt(cot.subtotal)}</Text>
            </View>
            <View style={styles.totalLine}>
              <Text style={styles.totalLabel}>IVA (16%)</Text>
              <Text style={styles.totalValue}>{fmt(cot.iva)}</Text>
            </View>
            <View style={styles.totalLineTotal}>
              <Text style={styles.totalLabelBig}>TOTAL</Text>
              <Text style={styles.totalValueBig}>{fmt(cot.total)}</Text>
            </View>
          </View>
        </View>

        {/* Condiciones */}
        {cot.condiciones && (
          <View style={styles.condBox}>
            <Text style={styles.condTitle}>Condiciones comerciales</Text>
            <Text style={styles.condText}>{cot.condiciones}</Text>
          </View>
        )}

        {haySujetoConfirmacion && (
          <View style={styles.confirmBadge}>
            <Text style={styles.confirmText}>
              * Los productos marcados están sujetos a confirmación de disponibilidad de inventario. ALFA-DEO se comunicará para confirmar antes de proceder.
            </Text>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>ALFA-DEO / Alianza Farmacéutica · alfadeo.mx</Text>
          <Text style={styles.pageNum} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>

      </Page>
    </Document>
  )

  return new Response(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${cot.folio}.pdf"`,
    },
  })
}
