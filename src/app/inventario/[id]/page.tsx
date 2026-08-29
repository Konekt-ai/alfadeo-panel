// Ficha de un producto: editarlo y moverle cantidades sin salir de aquí
// (punto 4 del cliente).
//
// Ojo con el `id` de la URL. La lista de inventario enlaza el renglón de
// `inventario`, que ES un lote, mientras que el buscador y los avisos de
// código duplicado enlazan el PRODUCTO. Los dos entran por esta misma ruta,
// así que lo primero que hace la página es resolver a qué producto se refiere
// el id que le llegó. Así ningún enlace viejo se rompe.

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeftIcon, ClockIcon, QrCodeIcon } from '@heroicons/react/20/solid'
import { sql, uno, faltaMigracion } from '@/lib/db'
import { resolverSucursal, usuarioActual } from '@/lib/usuario'
import { formatDate, formatDia, movimientoColor, movimientoLabel } from '@/lib/utils'
import type { Movimiento } from '@/lib/types'
import EditarProducto, {
  type LoteFila, type ProductoFila, type Sugerencias,
} from './EditarProducto'

export const dynamic = 'force-dynamic'

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const thCls = 'text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide'

const piezas = (n: number | null | undefined) => {
  const v = Number(n ?? 0)
  return Number.isInteger(v) ? v.toLocaleString('es-MX') : v.toLocaleString('es-MX', { maximumFractionDigits: 3 })
}

export default async function ProductoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!ES_UUID.test(id ?? '')) return notFound()

  // ¿Vino el id de un lote o el del producto? Se acepta cualquiera de los dos.
  const { data: ref, error: errorRef } = await uno<{ producto_id: string | null }>(
    `select coalesce(
              (select i.producto_id from inventario i where i.id = $1::uuid),
              (select p.id          from productos  p where p.id = $1::uuid)
            ) as producto_id`,
    [id]
  )
  if (errorRef) return <ErrorDeBase mensaje={errorRef.message} />
  if (!ref?.producto_id) return notFound()

  const productoId = ref.producto_id

  const { data: producto, error: errorProducto } = await uno<ProductoFila>(
    `select id, nombre, nombre_comercial, nombre_generico, concentracion,
            forma_farmaceutica, presentacion, laboratorio, categoria,
            codigo_barras, precio_base, tasa_iva, controlado, activo, stock_minimo
       from productos
      where id = $1::uuid`,
    [productoId]
  )
  if (errorProducto) return <ErrorDeBase mensaje={errorProducto.message} />
  if (!producto) return notFound()

  // Una fila de `inventario` es un lote. Orden FEFO: primero lo que caduca.
  const { data: lotes, error: errorLotes } = await sql<LoteFila>(
    `select i.id, i.lote, i.caducidad, i.ubicacion, i.existencia, i.costo_unitario,
            i.sucursal_id, s.clave as sucursal_clave, s.nombre as sucursal_nombre
       from inventario i
       left join sucursales s on s.id = i.sucursal_id
      where i.producto_id = $1::uuid
      order by s.clave nulls last, i.caducidad asc nulls last, i.lote asc nulls last`,
    [productoId]
  )

  const { data: movimientos, error: errorMovs } = await sql<Movimiento>(
    `select * from v_movimientos
      where producto_id = $1::uuid
      order by created_at desc, id desc
      limit 30`,
    [productoId]
  )

  const { data: sucursales, error: errorPlazas } = await sql<{ id: string; clave: string; nombre: string }>(
    `select id, clave, nombre from sucursales where activo order by es_matriz desc, clave`
  )

  // Mismos catálogos que el alta, para que la captura no invente variantes.
  const { data: valores } = await sql<{ campo: string; valor: string }>(
    `select 'laboratorio'  as campo, laboratorio        as valor from productos where activo and laboratorio        is not null
      union
     select 'categoria',           categoria                    from productos where activo and categoria          is not null
      union
     select 'forma',               forma_farmaceutica           from productos where activo and forma_farmaceutica is not null
      union
     select 'presentacion',        presentacion                 from productos where activo and presentacion       is not null
      order by 1, 2`
  )
  const deCampo = (campo: string) => valores.filter(v => v.campo === campo).map(v => v.valor)
  const sugerencias: Sugerencias = {
    laboratorios: deCampo('laboratorio'),
    categorias: deCampo('categoria'),
    formas: deCampo('forma'),
    presentaciones: deCampo('presentacion'),
  }

  const plaza = await resolverSucursal()
  const usuario = usuarioActual()

  const error = errorLotes ?? errorMovs ?? errorPlazas
  const titulo = producto.nombre_comercial || producto.nombre_generico || producto.nombre || 'Producto'
  const total = lotes.reduce((s, l) => s + Number(l.existencia ?? 0), 0)
  const activo = producto.activo !== false

  return (
    <div className="p-8">
      <Link
        href="/inventario"
        className="inline-flex items-center gap-1.5 text-base text-gray-400 hover:text-gray-600 mb-6"
      >
        <ArrowLeftIcon className="w-4 h-4" /> Inventario
      </Link>

      {/* ---- Encabezado --------------------------------------------------- */}
      <div className="mb-8">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-gray-900">{titulo}</h1>
          {!activo && (
            <span className="text-sm font-semibold px-2.5 py-1 rounded-md bg-gray-200 text-gray-600">
              Desactivado
            </span>
          )}
          {producto.controlado && (
            <span className="text-sm font-semibold px-2.5 py-1 rounded-md bg-red-50 text-red-700">
              Controlado
            </span>
          )}
        </div>
        <p className="text-base text-gray-500 mt-1">
          {[producto.nombre_generico, producto.forma_farmaceutica, producto.concentracion, producto.presentacion]
            .filter(Boolean)
            .join(' · ') || 'Sin desglose capturado'}
        </p>
        <div className="flex flex-wrap items-center gap-4 mt-3 text-base">
          <span className="inline-flex items-center gap-1.5 text-gray-600">
            <QrCodeIcon className="w-4 h-4 text-gray-400" />
            {producto.codigo_barras
              ? <span className="font-mono">{producto.codigo_barras}</span>
              : <span className="text-amber-700">Sin código de barras</span>}
          </span>
          <span className="text-gray-600">
            IVA {Number(producto.tasa_iva ?? 0) === 0.16 ? '16%' : '0%'}
          </span>
          <span className="text-gray-600">
            <strong className="text-gray-900">{piezas(total)}</strong> pza en{' '}
            {lotes.length} {lotes.length === 1 ? 'lote' : 'lotes'}
          </span>
        </div>
      </div>

      {error && <ErrorDeBase mensaje={error.message} />}

      <EditarProducto
        producto={producto}
        lotes={lotes}
        sucursales={sucursales}
        sucursalInicial={plaza?.id ?? sucursales[0]?.id ?? ''}
        usuario={usuario}
        sugerencias={sugerencias}
      />

      {/* ---- Historial ---------------------------------------------------- */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mt-6">
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900 inline-flex items-center gap-2">
            <ClockIcon className="w-5 h-5 text-gray-400" />
            Últimos movimientos
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Los 30 más recientes de este producto. El kardex completo está en{' '}
            <Link href="/movimientos" className="text-[#003366] hover:underline">Movimientos</Link>.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-base min-w-[900px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className={thCls}>Cuándo</th>
                <th className={thCls}>Tipo</th>
                <th className={thCls}>Cantidad</th>
                <th className={thCls}>Quedó en</th>
                <th className={thCls}>Lote</th>
                <th className={thCls}>Plaza</th>
                <th className={thCls}>Motivo</th>
                <th className={thCls}>Quién</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {movimientos.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-20 text-gray-400 text-base">
                    Todavía no se le ha movido nada a este producto.
                  </td>
                </tr>
              )}
              {movimientos.map(m => (
                <tr key={m.id} className="hover:bg-gray-50/60 transition-colors">
                  <td className="px-5 py-4 text-gray-600 whitespace-nowrap">{formatDate(m.created_at)}</td>
                  <td className="px-5 py-4">
                    <span className={`text-sm font-semibold px-2.5 py-1 rounded-md whitespace-nowrap ${movimientoColor(m.tipo)}`}>
                      {movimientoLabel(m.tipo)}
                    </span>
                  </td>
                  <td className="px-5 py-4 whitespace-nowrap">
                    <span className={`font-semibold ${m.cantidad > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                      {m.cantidad > 0 ? '+' : '−'}{piezas(Math.abs(Number(m.cantidad)))}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-gray-500 whitespace-nowrap">
                    {piezas(m.existencia_antes)} → <strong className="text-gray-900">{piezas(m.existencia_despues)}</strong>
                  </td>
                  <td className="px-5 py-4 font-mono text-sm text-gray-500">
                    {m.lote ?? '—'}
                    {m.caducidad && (
                      <span className="block font-sans text-sm text-gray-400">{formatDia(m.caducidad)}</span>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    {m.sucursal ? (
                      <span className={`text-sm font-semibold px-2.5 py-1 rounded-md whitespace-nowrap ${
                        m.sucursal === 'GDL' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'
                      }`}>
                        {m.sucursal}
                      </span>
                    ) : (
                      <span className="text-sm text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-gray-600">{m.motivo ?? '—'}</td>
                  <td className="px-5 py-4 text-gray-500">{m.usuario ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function ErrorDeBase({ mensaje }: { mensaje: string }) {
  return (
    <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-6 text-base">
      {mensaje}
      {faltaMigracion(mensaje) && (
        <p className="mt-2 text-sm">
          Falta preparar la base. En esa computadora corre{' '}
          <code className="font-mono">instalacion\instalar-base.ps1</code>.
        </p>
      )}
    </div>
  )
}
