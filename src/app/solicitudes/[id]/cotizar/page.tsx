import { supabase } from '@/lib/supabase'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { ArrowLeftIcon } from '@heroicons/react/20/solid'
import type { Producto, SolicitudItem } from '@/lib/types'
import CotizadorForm from './CotizadorForm'

export const dynamic = 'force-dynamic'

async function guardarCotizacion(form: FormData) {
  'use server'

  const solicitud_id = form.get('solicitud_id') as string
  const cliente_id = form.get('cliente_id') as string
  const vigencia_dias = Number(form.get('vigencia_dias') || 15)
  const condiciones = form.get('condiciones') as string
  const notas = form.get('notas') as string

  const itemsRaw = form.get('items') as string
  const items: {
    descripcion: string
    producto_id: string
    cantidad: number
    unidad: string
    precio_unitario: number
    iva_exento: boolean
    sujeto_confirmacion: boolean
  }[] = JSON.parse(itemsRaw || '[]')

  if (!items.length) return

  let subtotal = 0
  let iva = 0
  for (const it of items) {
    const s = it.cantidad * it.precio_unitario
    subtotal += s
    if (!it.iva_exento) iva += s * 0.16
  }
  const total = subtotal + iva

  const hoy = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const { count } = await supabase
    .from('cotizaciones')
    .select('id', { count: 'exact', head: true })
    .like('folio', `COT-${hoy}-%`)
  const folio = `COT-${hoy}-${String((count ?? 0) + 1).padStart(4, '0')}`

  const { data: cot, error } = await supabase
    .from('cotizaciones')
    .insert({
      folio,
      solicitud_id,
      cliente_id: cliente_id || null,
      vigencia_dias,
      condiciones: condiciones || null,
      notas: notas || null,
      subtotal: Math.round(subtotal * 100) / 100,
      iva: Math.round(iva * 100) / 100,
      total: Math.round(total * 100) / 100,
    })
    .select('id')
    .single()

  if (error || !cot) return

  await supabase.from('cotizacion_items').insert(
    items.map((it, i) => ({
      cotizacion_id: cot.id,
      producto_id: it.producto_id || null,
      descripcion: it.descripcion,
      cantidad: it.cantidad,
      unidad: it.unidad || null,
      precio_unitario: it.precio_unitario,
      iva_exento: it.iva_exento,
      sujeto_confirmacion: it.sujeto_confirmacion,
      posicion: i + 1,
    }))
  )

  await supabase
    .from('solicitudes')
    .update({ estado: 'cotizada' })
    .eq('id', solicitud_id)

  revalidatePath('/solicitudes')
  revalidatePath(`/solicitudes/${solicitud_id}`)
  redirect(`/solicitudes/${solicitud_id}`)
}

export default async function CotizadorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [{ data: sol }, { data: productos }] = await Promise.all([
    supabase
      .from('solicitudes')
      .select('id, folio, cliente_id, clientes(nombre, empresa), solicitud_items(id, descripcion_libre, cantidad, unidad, nota)')
      .eq('id', id)
      .single(),
    supabase
      .from('productos')
      .select('id, nombre, laboratorio, presentacion, unidad, precio_base, iva_exento, activo')
      .eq('activo', true)
      .order('nombre'),
  ])

  if (!sol) return notFound()

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <Link href={`/solicitudes/${id}`} className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 mb-6">
        <ArrowLeftIcon className="w-3.5 h-3.5" /> Solicitud #{sol.folio}
      </Link>
      <h1 className="text-xl font-semibold text-gray-900 mb-2">Nueva cotización</h1>
      <p className="text-sm text-gray-400 mb-8">
        {(sol.clientes as any)?.nombre} · {(sol.clientes as any)?.empresa}
      </p>
      <CotizadorForm
        solicitudId={id}
        clienteId={sol.cliente_id ?? ''}
        items={(sol.solicitud_items as SolicitudItem[]) ?? []}
        productos={(productos as Producto[]) ?? []}
        action={guardarCotizacion}
      />
    </div>
  )
}
