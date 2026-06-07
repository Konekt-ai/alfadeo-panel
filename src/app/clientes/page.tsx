import { supabase } from '@/lib/supabase'
import type { Cliente } from '@/lib/types'
import { tipoClienteLabel, formatDate } from '@/lib/utils'
import { PhoneIcon, EnvelopeIcon } from '@heroicons/react/20/solid'

export const dynamic = 'force-dynamic'

export default async function ClientesPage() {
  const { data: clientes, error } = await supabase
    .from('clientes')
    .select('*')
    .order('created_at', { ascending: false })

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-gray-900">Clientes</h1>
        <p className="text-sm text-gray-400 mt-0.5">{clientes?.length ?? 0} registrados</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-6 text-sm">
          Error al cargar: {error.message}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Nombre</th>
              <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Empresa</th>
              <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Tipo</th>
              <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Ciudad</th>
              <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Contacto</th>
              <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Registro</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {(!clientes || clientes.length === 0) && (
              <tr>
                <td colSpan={6} className="text-center py-20 text-gray-300 text-sm">
                  No hay clientes registrados aún.
                </td>
              </tr>
            )}
            {clientes?.map((c: Cliente) => (
              <tr key={c.id} className="hover:bg-gray-50/60 transition-colors">
                <td className="px-5 py-4 font-medium text-gray-900">{c.nombre ?? '—'}</td>
                <td className="px-5 py-4 text-gray-600">{c.empresa ?? '—'}</td>
                <td className="px-5 py-4">
                  <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded-md">
                    {tipoClienteLabel(c.tipo)}
                  </span>
                </td>
                <td className="px-5 py-4 text-gray-500">{c.ciudad ?? '—'}</td>
                <td className="px-5 py-4">
                  <div className="flex flex-col gap-1.5">
                    {c.telefono_wa && (
                      <a href={`https://wa.me/${c.telefono_wa}`} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-700 hover:text-teal-800 transition-colors">
                        <PhoneIcon className="w-3 h-3" />
                        {c.telefono_wa}
                      </a>
                    )}
                    {c.correo && (
                      <a href={`mailto:${c.correo}`}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-[#003366] hover:underline transition-colors">
                        <EnvelopeIcon className="w-3 h-3" />
                        {c.correo}
                      </a>
                    )}
                    {!c.telefono_wa && !c.correo && <span className="text-gray-300 text-xs">—</span>}
                  </div>
                </td>
                <td className="px-5 py-4 text-gray-400 text-xs whitespace-nowrap">{formatDate(c.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
