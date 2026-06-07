import { supabase } from '@/lib/supabase'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { ArrowLeftIcon } from '@heroicons/react/20/solid'
import { UBICACIONES } from '../page'

export const dynamic = 'force-dynamic'

async function crearProducto(form: FormData) {
  'use server'
  const nombre = form.get('nombre') as string
  const laboratorio = form.get('laboratorio') as string
  const lote = form.get('lote') as string
  const mes = form.get('cad_mes') as string
  const anio = form.get('cad_anio') as string
  const caducidad = mes && anio ? `${anio}-${mes}-01` : null
  const existencia = Number(form.get('existencia') || 0)
  const ubicacion = form.get('ubicacion') as string

  const { data: prod } = await supabase.from('productos').insert({
    nombre, laboratorio, lote, caducidad, activo: true,
  }).select('id').single()

  if (prod) {
    await supabase.from('inventario').insert({
      producto_id: prod.id, existencia, ubicacion,
    })
  }

  revalidatePath('/inventario')
  redirect('/inventario')
}

const MESES = [
  { v: '01', l: 'Enero' }, { v: '02', l: 'Febrero' }, { v: '03', l: 'Marzo' },
  { v: '04', l: 'Abril' }, { v: '05', l: 'Mayo' }, { v: '06', l: 'Junio' },
  { v: '07', l: 'Julio' }, { v: '08', l: 'Agosto' }, { v: '09', l: 'Septiembre' },
  { v: '10', l: 'Octubre' }, { v: '11', l: 'Noviembre' }, { v: '12', l: 'Diciembre' },
]
const anioActual = new Date().getFullYear()
const ANIOS = Array.from({ length: 6 }, (_, i) => anioActual + i)

export default async function NuevoProductoPage() {
  return (
    <div className="p-8 max-w-2xl">
      <Link href="/inventario" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 mb-6">
        <ArrowLeftIcon className="w-3.5 h-3.5" /> Inventario
      </Link>
      <h1 className="text-xl font-semibold text-gray-900 mb-8">Agregar producto</h1>

      <form action={crearProducto} className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
        <Field label="Nombre del producto *" name="nombre" required placeholder="Ej. ABIRATERONA TAB 500 mg C/60" />
        <Field label="Laboratorio" name="laboratorio" placeholder="Ej. GLENMARK" />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Lote" name="lote" placeholder="Ej. 13250125" />
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Caducidad</label>
            <div className="grid grid-cols-2 gap-2">
              <select name="cad_mes" className={selectCls}>
                <option value="">Mes</option>
                {MESES.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
              </select>
              <select name="cad_anio" className={selectCls}>
                <option value="">Año</option>
                {ANIOS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Existencia (piezas) *</label>
            <input type="number" name="existencia" min="0" defaultValue="0" required className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Ubicación *</label>
            <select name="ubicacion" required className={selectCls}>
              <option value="">Seleccionar...</option>
              {UBICACIONES.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>
        <div className="pt-2 flex gap-3">
          <button type="submit" className="px-5 py-2 bg-[#003366] text-white text-sm font-medium rounded-lg hover:bg-[#002244] transition-colors">
            Guardar producto
          </button>
          <Link href="/inventario" className="px-5 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors">
            Cancelar
          </Link>
        </div>
      </form>
    </div>
  )
}

const inputCls = "w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366]"
const selectCls = "w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366] bg-white"

function Field({ label, name, required, placeholder }: { label: string; name: string; required?: boolean; placeholder?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1.5">{label}</label>
      <input type="text" name={name} required={required} placeholder={placeholder} className={inputCls} />
    </div>
  )
}
