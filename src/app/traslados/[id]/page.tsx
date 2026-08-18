import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  PaperAirplaneIcon,
  InboxArrowDownIcon,
  CheckCircleIcon,
} from '@heroicons/react/20/solid'
import { InformationCircleIcon } from '@heroicons/react/24/outline'
import { uno, sql, faltaMigracion } from '@/lib/db'
import { UBICACIONES } from '@/lib/constantes'
import { formatDia, formatDate, nombreProducto } from '@/lib/utils'
import type { EstadoTraslado } from '@/lib/types'
import { enviarTrasladoAccion, recibirTrasladoAccion, cancelarTrasladoAccion } from '../acciones'

export const dynamic = 'force-dynamic'

// Detalle del traslado. Es el mismo documento en los dos extremos: se
// envía desde el origen y se recibe en el destino con el MISMO lote y la
// misma caducidad, sin volver a capturar nada (minuta 37).

// Lo que devuelve `descontar_fefo` y queda en traslado_items.lotes: de
// qué lote salió cada pieza. Ojo: la clave es `cantidad`, no
// `existencia` como en el tipo `Lote` del catálogo.
interface LoteSalida {
  lote: string | null
  caducidad: string | null
  ubicacion: string | null
  cantidad: number
  costo: number | null
}

interface ProductoFila {
  id: string
  nombre: string | null
  nombre_comercial: string | null
  nombre_generico: string | null
  concentracion: string | null
  presentacion: string | null
  laboratorio: string | null
}

interface ItemFila {
  id: string
  producto_id: string
  cantidad: number
  lote: string | null
  caducidad: string | null
  lotes: LoteSalida[] | null
  posicion: number
  productos: ProductoFila | null
}

interface TrasladoDetalle {
  id: string
  folio: string | null
  origen_id: string
  destino_id: string
  estado: EstadoTraslado
  paqueteria: string | null
  guia: string | null
  fecha_envio: string | null
  fecha_estimada: string | null
  fecha_recepcion: string | null
  usuario: string | null
  notas: string | null
  created_at: string
  traslado_items: ItemFila[]
}

interface Plaza {
  id: string
  clave: string | null
  nombre: string | null
  ciudad: string | null
}

function trasladoLabel(e: EstadoTraslado) {
  const map: Record<EstadoTraslado, string> = {
    borrador: 'Borrador',
    en_transito: 'En tránsito',
    recibido: 'Recibido',
    cancelado: 'Cancelado',
  }
  return map[e] ?? e
}

function trasladoColor(e: EstadoTraslado) {
  const map: Record<EstadoTraslado, string> = {
    borrador: 'bg-gray-100 text-gray-700',
    en_transito: 'bg-amber-100 text-amber-800',
    recibido: 'bg-emerald-100 text-emerald-800',
    cancelado: 'bg-gray-100 text-gray-400',
  }
  return map[e] ?? 'bg-gray-100 text-gray-700'
}

export default async function TrasladoDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { id } = await params
  const { error: errorRpc } = await searchParams

  // Las partidas van como json_agg para que el objeto llegue con la misma
  // forma que tenía con el embebido, y el JSX no cambie. El coalesce a '[]'
  // importa: json_agg sin filas devuelve NULL, no un arreglo vacío.
  const [{ data, error }, { data: datosPlazas }] = await Promise.all([
    uno<TrasladoDetalle>(
      `select t.id, t.folio, t.origen_id, t.destino_id, t.estado, t.paqueteria,
              t.guia, t.fecha_envio, t.fecha_estimada, t.fecha_recepcion,
              t.usuario, t.notas, t.created_at,
              coalesce((
                select json_agg(json_build_object(
                         'id', ti.id, 'producto_id', ti.producto_id,
                         'cantidad', ti.cantidad, 'lote', ti.lote,
                         'caducidad', ti.caducidad, 'lotes', ti.lotes,
                         'posicion', ti.posicion,
                         'productos', case when p.id is null then null else
                           json_build_object(
                             'id', p.id, 'nombre', p.nombre,
                             'nombre_comercial', p.nombre_comercial,
                             'nombre_generico', p.nombre_generico,
                             'concentracion', p.concentracion,
                             'presentacion', p.presentacion,
                             'laboratorio', p.laboratorio)
                         end
                       ) order by ti.posicion)
                  from traslado_items ti
                  left join productos p on p.id = ti.producto_id
                 where ti.traslado_id = t.id
              ), '[]'::json) as traslado_items
         from traslados t
        where t.id = $1::uuid`,
      [id]
    ),
    sql<{ id: string; clave: string; nombre: string; ciudad: string | null }>(
      `select id, clave, nombre, ciudad from sucursales`
    ),
  ])

  // Si la migración no está corrida, el error es de esquema y hay que
  // decirlo; si simplemente no existe el folio, es un 404.
  if (error && faltaMigracion(error.message)) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-base">
          {error.message}
          <p className="mt-2 text-sm">
            Falta preparar la base. En esa computadora corre{' '}
              <code className="font-mono">instalacion\instalar-base.ps1</code>.
          </p>
        </div>
      </div>
    )
  }
  if (error || !data) return notFound()

  // PostgREST no tipa los embeds sin tipos generados; se afirma la forma
  // que pide el `select` de arriba.
  const t = data as unknown as TrasladoDetalle
  const plazas = (datosPlazas ?? []) as unknown as Plaza[]

  const porId = new Map(plazas.map(p => [p.id, p]))
  const origen = porId.get(t.origen_id)
  const destino = porId.get(t.destino_id)
  const origenNombre = origen?.nombre ?? origen?.clave ?? 'origen'
  const destinoNombre = destino?.nombre ?? destino?.clave ?? 'destino'

  const items = [...(t.traslado_items ?? [])].sort((a, b) => a.posicion - b.posicion)
  const piezas = items.reduce((s, i) => s + Number(i.cantidad ?? 0), 0)

  const enviado = t.estado !== 'borrador' && t.estado !== 'cancelado'

  // El kardex se abre filtrado por ESTE traslado y por el tipo, así que cada
  // enlace lleva exactamente a su mitad: la salida en origen y la entrada en
  // destino. La plaza va de más porque el tipo ya la determina, pero deja el
  // filtro visible en la pantalla del kardex.
  const urlKardex = (tipo: 'traslado_salida' | 'traslado_entrada', clave: string | null | undefined) =>
    `/movimientos?referencia=${t.id}&tipo=${tipo}` +
    (clave ? `&sucursal=${encodeURIComponent(clave)}` : '')

  return (
    <div className="p-8">
      <Link
        href="/traslados"
        className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 mb-6"
      >
        <ArrowLeftIcon className="w-3.5 h-3.5" /> Traslados
      </Link>

      <div className="flex items-start justify-between gap-4 mb-8 flex-wrap">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold text-gray-900 font-mono">
              {t.folio ?? 'Traslado sin folio'}
            </h1>
            <span className={`text-sm font-semibold px-2.5 py-1 rounded-md ${trasladoColor(t.estado)}`}>
              {trasladoLabel(t.estado)}
            </span>
          </div>
          <p className="text-base text-gray-500 mt-1">
            Capturado el {formatDate(t.created_at)}
            {t.usuario && ` por ${t.usuario}`}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-base font-semibold px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 whitespace-nowrap">
            {origen?.clave ?? '—'} · {origenNombre}
          </span>
          <ArrowRightIcon className="w-5 h-5 text-gray-300" />
          <span className="text-base font-semibold px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 whitespace-nowrap">
            {destino?.clave ?? '—'} · {destinoNombre}
          </span>
        </div>
      </div>

      {/* El error del RPC, tal cual lo manda Postgres. */}
      {errorRpc && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-6 text-base">
          {errorRpc}
          {faltaMigracion(errorRpc) && (
            <p className="mt-2 text-sm">
              Falta preparar la base. En esa computadora corre{' '}
              <code className="font-mono">instalacion\instalar-base.ps1</code>.
            </p>
          )}
        </div>
      )}

      {/* Encabezado */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 md:p-6 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <Dato titulo="Paquetería" valor={t.paqueteria ?? '—'} />
          <Dato titulo="Guía" valor={t.guia ?? '—'} mono />
          <Dato titulo="Fecha de envío" valor={t.fecha_envio ? formatDate(t.fecha_envio) : 'Sin enviar'} />
          <Dato titulo="Llegada estimada" valor={formatDia(t.fecha_estimada)} />
        </div>
        {(t.fecha_recepcion || t.notas) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mt-5 pt-5 border-t border-gray-100">
            {t.fecha_recepcion && (
              <Dato titulo="Recibido" valor={formatDate(t.fecha_recepcion)} />
            )}
            {t.notas && <Dato titulo="Notas" valor={t.notas} />}
          </div>
        )}
      </div>

      {/* Partidas */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-base font-semibold text-gray-900">
            Partidas
            <span className="text-base font-normal text-gray-500 ml-2">
              {items.length} {items.length === 1 ? 'partida' : 'partidas'} · {piezas.toLocaleString('es-MX')} piezas
            </span>
          </h2>
          {enviado && (
            <span className="text-sm text-gray-500">
              Los lotes son los que salieron de verdad de {origenNombre}.
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-base min-w-[760px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Producto</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Cantidad</th>
                <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Lotes que salieron</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {items.length === 0 && (
                <tr>
                  <td colSpan={3} className="text-center py-20 text-gray-400 text-base">
                    Este traslado no tiene partidas.
                  </td>
                </tr>
              )}
              {items.map(item => {
                const p = item.productos
                const lotes = item.lotes ?? []
                return (
                  <tr key={item.id} className="align-top">
                    <td className="px-5 py-4">
                      <div className="font-semibold text-gray-900">
                        {p ? nombreProducto(p) : 'Producto no encontrado'}
                      </div>
                      {p && (
                        <div className="text-sm text-gray-500 mt-0.5">
                          {[p.concentracion, p.presentacion, p.laboratorio].filter(Boolean).join(' · ') || '—'}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <span className="text-lg font-semibold text-gray-900">
                        {Number(item.cantidad).toLocaleString('es-MX')}
                      </span>
                      <span className="text-sm text-gray-400 ml-1.5">pz</span>
                    </td>
                    <td className="px-5 py-4">
                      {lotes.length === 0 ? (
                        <span className="text-sm text-gray-400">
                          Se define al enviar: sale primero lo que caduca antes (FEFO).
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {lotes.map((l, i) => (
                            <span
                              key={`${item.id}-${l.lote ?? 'sinlote'}-${i}`}
                              className="text-sm font-medium text-gray-700 bg-gray-100 px-2.5 py-1 rounded-md"
                            >
                              {l.lote ?? 'sin lote'} · cad. {formatDia(l.caducidad)} ·{' '}
                              {Number(l.cantidad ?? 0).toLocaleString('es-MX')} pz
                              {l.ubicacion && ` · ${l.ubicacion}`}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Qué se puede hacer, según el estado */}
      {t.estado === 'borrador' && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 md:p-6">
          <div className="flex items-start gap-2.5 mb-5">
            <InformationCircleIcon className="w-5 h-5 text-[#003366] shrink-0 mt-0.5" />
            <p className="text-base text-gray-700">
              Todavía no se ha movido ni una pieza. Al enviar se descuenta de{' '}
              <strong>{origenNombre}</strong> tomando primero los lotes que caducan antes,
              y el traslado queda en tránsito.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <form action={enviarTrasladoAccion}>
              <input type="hidden" name="traslado_id" value={t.id} />
              <button
                type="submit"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#003366] text-white text-base font-medium rounded-lg hover:bg-[#002244] transition-colors"
              >
                <PaperAirplaneIcon className="w-5 h-5" />
                Enviar
              </button>
            </form>
            <form action={cancelarTrasladoAccion}>
              <input type="hidden" name="traslado_id" value={t.id} />
              <button
                type="submit"
                className="w-full sm:w-auto px-5 py-2.5 text-base font-medium text-red-600 hover:text-red-700 transition-colors"
              >
                Cancelar traslado
              </button>
            </form>
          </div>
        </div>
      )}

      {t.estado === 'en_transito' && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 md:p-6">
          <div className="flex items-start gap-2.5 mb-5">
            <InformationCircleIcon className="w-5 h-5 text-[#003366] shrink-0 mt-0.5" />
            <p className="text-base text-gray-700">
              La mercancía ya salió de <strong>{origenNombre}</strong>. Al recibirla entra en{' '}
              <strong>{destinoNombre}</strong> con el mismo lote y la misma caducidad: es el
              mismo documento, no hay que capturar nada de nuevo.
            </p>
          </div>
          <form action={recibirTrasladoAccion} className="flex flex-col sm:flex-row sm:items-end gap-3">
            <input type="hidden" name="traslado_id" value={t.id} />
            <div className="sm:w-72">
              <label className="block text-sm font-medium text-gray-500 mb-1.5">
                Ubicación en {destinoNombre}
              </label>
              <select
                name="ubicacion"
                required
                defaultValue=""
                className="w-full px-4 py-3 text-base border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366] bg-white"
              >
                <option value="">Seleccionar...</option>
                {UBICACIONES.map(u => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#003366] text-white text-base font-medium rounded-lg hover:bg-[#002244] transition-colors"
            >
              <InboxArrowDownIcon className="w-5 h-5" />
              Recibir en {destino?.clave ?? destinoNombre}
            </button>
          </form>
        </div>
      )}

      {t.estado === 'recibido' && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 md:p-6">
          <div className="flex items-start gap-2.5">
            <CheckCircleIcon className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-base text-emerald-900">
                Recibido en <strong>{destinoNombre}</strong>
                {t.fecha_recepcion && ` el ${formatDate(t.fecha_recepcion)}`}. El documento ya no
                se puede modificar: los dos movimientos quedaron asentados en el kardex.
              </p>
              <div className="flex flex-wrap gap-x-6 gap-y-2 mt-3">
                <Link
                  href={urlKardex('traslado_entrada', destino?.clave)}
                  className="text-base font-medium text-[#003366] hover:underline"
                >
                  Ver la entrada en {destinoNombre} →
                </Link>
                <Link
                  href={urlKardex('traslado_salida', origen?.clave)}
                  className="text-base font-medium text-[#003366] hover:underline"
                >
                  Ver la salida de {origenNombre} →
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {t.estado === 'cancelado' && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 md:p-6 text-base text-gray-600">
          Este traslado se canceló antes de enviarse: no movió inventario en ninguna plaza.
        </div>
      )}
    </div>
  )
}

function Dato({ titulo, valor, mono }: { titulo: string; valor: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-sm font-semibold text-gray-500 uppercase tracking-wide">{titulo}</div>
      <div className={`text-base text-gray-900 mt-1 ${mono ? 'font-mono' : ''}`}>{valor}</div>
    </div>
  )
}
