import { sql, uno, enTransaccion } from '@/lib/db'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { ArrowLeftIcon } from '@heroicons/react/20/solid'
import type { Producto, SolicitudItem, OpcionCompra, Margen, TipoCliente } from '@/lib/types'
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
    proveedor_id: string | null
    origen_compra: string | null
    costo_unitario: number | null
    margen_pct: number | null
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

  // Folio, cabecera, partidas y el cambio de estado, todo en una
  // transacción: antes, si fallaban las partidas quedaba una cotización
  // vacía con folio consumido.
  try {
    await enTransaccion(async ejecutar => {
      const [{ n }] = await ejecutar<{ n: number }>(
        `select count(*)::int as n from cotizaciones where folio like $1`,
        [`COT-${hoy}-%`]
      )
      const folio = `COT-${hoy}-${String(n + 1).padStart(4, '0')}`

      const [cot] = await ejecutar<{ id: string }>(
        `insert into cotizaciones (folio, solicitud_id, cliente_id, vigencia_dias,
                                   condiciones, notas, subtotal, iva, total)
         values ($1, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9)
         returning id`,
        [
          folio, solicitud_id, cliente_id || null, vigencia_dias,
          condiciones || null, notas || null,
          Math.round(subtotal * 100) / 100,
          Math.round(iva * 100) / 100,
          Math.round(total * 100) / 100,
        ]
      )

      // unnest en vez de un insert por partida: un solo viaje a la base.
      await ejecutar(
        `insert into cotizacion_items
           (cotizacion_id, producto_id, descripcion, cantidad, unidad,
            precio_unitario, iva_exento, sujeto_confirmacion, proveedor_id,
            origen_compra, costo_unitario, margen_pct, posicion)
         select $1::uuid, u.producto_id::uuid, u.descripcion, u.cantidad, u.unidad,
                u.precio_unitario, u.iva_exento, u.sujeto_confirmacion,
                u.proveedor_id::uuid, u.origen_compra, u.costo_unitario,
                u.margen_pct, u.posicion
           from unnest($2::text[], $3::text[], $4::numeric[], $5::text[],
                       $6::numeric[], $7::boolean[], $8::boolean[], $9::text[],
                       $10::text[], $11::numeric[], $12::numeric[], $13::int[])
                as u(producto_id, descripcion, cantidad, unidad, precio_unitario,
                     iva_exento, sujeto_confirmacion, proveedor_id, origen_compra,
                     costo_unitario, margen_pct, posicion)`,
        [
          cot.id,
          items.map(it => it.producto_id || null),
          items.map(it => it.descripcion),
          items.map(it => it.cantidad),
          items.map(it => it.unidad || null),
          items.map(it => it.precio_unitario),
          items.map(it => it.iva_exento),
          items.map(it => it.sujeto_confirmacion),
          items.map(it => it.proveedor_id || null),
          items.map(it => it.origen_compra || null),
          items.map(it => it.costo_unitario),
          items.map(it => it.margen_pct),
          items.map((_, i) => i + 1),
        ]
      )

      await ejecutar(
        `update solicitudes set estado = 'cotizada' where id = $1::uuid`,
        [solicitud_id]
      )
    })
  } catch {
    // Se conserva el comportamiento anterior: si algo falla, no se navega
    // y el formulario se queda como estaba.
    return
  }

  revalidatePath('/solicitudes')
  revalidatePath(`/solicitudes/${solicitud_id}`)
  redirect(`/solicitudes/${solicitud_id}`)
}

export default async function CotizadorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [{ data: sol }, { data: productos }, { data: opciones }, { data: margenes }] = await Promise.all([
    uno<{
      id: string
      folio: number
      cliente_id: string | null
      clientes: { nombre: string | null; empresa: string | null; tipo: TipoCliente | null } | null
      solicitud_items: SolicitudItem[]
    }>(
      `select s.id, s.folio, s.cliente_id,
              case when c.id is null then null else
                json_build_object('nombre', c.nombre, 'empresa', c.empresa, 'tipo', c.tipo)
              end as clientes,
              coalesce((
                select json_agg(json_build_object(
                         'id', si.id, 'descripcion_libre', si.descripcion_libre,
                         'cantidad', si.cantidad, 'unidad', si.unidad, 'nota', si.nota))
                  from solicitud_items si where si.solicitud_id = s.id
              ), '[]'::json) as solicitud_items
         from solicitudes s
         left join clientes c on c.id = s.cliente_id
        where s.id = $1::uuid`,
      [id]
    ),
    sql<Producto>(
      `select id, nombre, laboratorio, presentacion, unidad, categoria,
              precio_base, iva_exento, activo
         from productos where activo order by nombre`
    ),
    sql<OpcionCompra>(
      `select producto_id, origen, proveedor_id, fuente_nombre, costo, existencia,
              en_stock, caducidad, moq, fecha_precio, match_score
         from v_opciones_compra`
    ),
    sql<Margen>(
      `select id, tipo_cliente, categoria, producto_id, margen_pct, prioridad, activo
         from margenes where activo`
    ),
  ])

  if (!sol) return notFound()

  // Agrupa opciones de compra por producto para el formulario.
  const opcionesPorProducto: Record<string, OpcionCompra[]> = {}
  for (const o of opciones) {
    if (!o.producto_id) continue
    ;(opcionesPorProducto[o.producto_id] ??= []).push(o)
  }

  const tipoCliente = sol.clientes?.tipo ?? null

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <Link href={`/solicitudes/${id}`} className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 mb-6">
        <ArrowLeftIcon className="w-3.5 h-3.5" /> Solicitud #{sol.folio}
      </Link>
      <h1 className="text-xl font-semibold text-gray-900 mb-2">Nueva cotización</h1>
      <p className="text-sm text-gray-400 mb-8">
        {sol.clientes?.nombre} · {sol.clientes?.empresa}
      </p>
      <CotizadorForm
        solicitudId={id}
        clienteId={sol.cliente_id ?? ''}
        tipoCliente={tipoCliente}
        items={(sol.solicitud_items as SolicitudItem[]) ?? []}
        productos={(productos as Producto[]) ?? []}
        opcionesPorProducto={opcionesPorProducto}
        margenes={(margenes as Margen[]) ?? []}
        action={guardarCotizacion}
      />
    </div>
  )
}
