import { supabase } from '@/lib/supabase'
import { redirect, notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { ArrowLeftIcon } from '@heroicons/react/20/solid'
import { UBICACIONES } from '../page'

export const dynamic = 'force-dynamic'

const MESES = [
  { v: '01', l: 'Enero' }, { v: '02', l: 'Febrero' }, { v: '03', l: 'Marzo' },
  { v: '04', l: 'Abril' }, { v: '05', l: 'Mayo' }, { v: '06', l: 'Junio' },
  { v: '07', l: 'Julio' }, { v: '08', l: 'Agosto' }, { v: '09', l: 'Septiembre' },
  { v: '10', l: 'Octubre' }, { v: '11', l: 'Noviembre' }, { v: '12', l: 'Diciembre' },
]
const anioActual = new Date().getFullYear()
const ANIOS = Array.from({ length: 6 }, (_, i) => anioActual + i)

async function actualizarProducto(form: FormData) {
  'use server'
  const inventario_id = form.get('inventario_id') as string
  const producto_id = form.get('producto_id') as string
  const nombre = form.get('nombre') as string
  const laboratorio = form.get('laboratorio') as string
  const lote = form.get('lote') as string
  const mes = form.get('cad_mes') as string
  const anio = form.get('cad_anio') as string
  const caducidad = mes && anio ? `${anio}-${mes}-01` : null
  const existencia = Number(form.get('existencia'))
  const ubicacion = form.get('ubicacion') as string

  await supabase.from('productos').update({ nombre, laboratorio, lote, caducidad }).eq('id', producto_id)
  await supabase.from('inventario').update({ existencia, ubicacion }).eq('id', inventario_id)

  revalidatePath('/inventario')
  redirect('/inventario')
}

async function eliminarProducto(form: FormData) {
  'use server'
  const inventario_id = form.get('inventario_id') as string
  const producto_id = form.get('producto_id') as string
  await supabase.from('inventario').delete().eq('id', inventario_id)
  await supabase.from('productos').delete().eq('id', producto_id)
  revalidatePath('/inventario')
  redirect('/inventario')
}

export default async function EditarProductoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data, error } = await supabase
    .from('inventario')
    .select('id, existencia, ubicacion, productos(id, nombre, laboratorio, lote, caducidad)')
    .eq('id', id)
    .single()

  if (error || !data) return notFound()

  const prod = data.productos as any
  const cadMes = prod?.caducidad ? prod.caducidad.slice(5, 7) : ''
  const cadAnio = prod?.caducidad ? prod.caducidad.slice(0, 4) : ''

  const inputCls = "w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366]"
  const selectCls = "w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366] bg-white"

  return (
    <div className="p-8 max-w-2xl">
      <Link href="/inventario" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 mb-6">
        <ArrowLeftIcon className="w-3.5 h-3.5" /> Inventario
      </Link>
      <h1 className="text-xl font-semibold text-gray-900 mb-8">Editar producto</h1>

      <form action={actualizarProducto} className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
        <input type="hidden" name="inventario_id" value={data.id} />
        <input type="hidden" name="producto_id" value={prod?.id} />

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Nombre del producto *</label>
          <input type="text" name="nombre" required defaultValue={prod?.nombre ?? ''} className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Laboratorio</label>
          <input type="text" name="laboratorio" defaultValue={prod?.laboratorio ?? ''} className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Lote</label>
            <input type="text" name="lote" defaultValue={prod?.lote ?? ''} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Caducidad</label>
            <div className="grid grid-cols-2 gap-2">
              <select name="cad_mes" defaultValue={cadMes} className={selectCls}>
                <option value="">Mes</option>
                {MESES.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
              </select>
              <select name="cad_anio" defaultValue={cadAnio} className={selectCls}>
                <option value="">Año</option>
                {ANIOS.map(a => <option key={a} value={String(a)}>{a}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Existencia (piezas) *</label>
            <input type="number" name="existencia" min="0" required defaultValue={data.existencia} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Ubicación *</label>
            <select name="ubicacion" required defaultValue={data.ubicacion ?? ''} className={selectCls}>
              <option value="">Seleccionar...</option>
              {UBICACIONES.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>

        <div className="pt-2 flex gap-3">
          <button type="submit" className="px-5 py-2 bg-[#003366] text-white text-sm font-medium rounded-lg hover:bg-[#002244] transition-colors">
            Guardar cambios
          </button>
          <Link href="/inventario" className="px-5 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors">
            Cancelar
          </Link>
        </div>
      </form>

      <form action={eliminarProducto} className="mt-4">
        <input type="hidden" name="inventario_id" value={data.id} />
        <input type="hidden" name="producto_id" value={prod?.id} />
        <button type="submit" className="px-4 py-2 text-sm font-medium text-red-500 hover:text-red-700 transition-colors">
          Eliminar producto
        </button>
      </form>
    </div>
  )
}
