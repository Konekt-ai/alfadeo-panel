import { supabase } from '@/lib/supabase'
import type { Cliente } from '@/lib/types'
import { tipoClienteLabel, formatDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function ClientesPage() {
  const { data: clientes, error } = await supabase
    .from('clientes')
    .select('*')
    .order('created_at', { ascending: false })

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Clientes</h1>
        <p className="text-sm text-gray-500 mt-0.5">{clientes?.length ?? 0} registrados</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-5 text-sm">
          Error al cargar: {error.message}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-3 font-medium text-gray-600">Nombre</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Empresa</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Tipo</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Ciudad</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">WhatsApp</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Correo</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Registro</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(!clientes || clientes.length === 0) && (
              <tr>
                <td colSpan={7} className="text-center py-16 text-gray-400">
                  No hay clientes registrados aún.
                </td>
              </tr>
            )}
            {clientes?.map((c: Cliente) => (
              <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-medium text-gray-900">{c.nombre ?? '—'}</td>
                <td className="px-4 py-3 text-gray-700">{c.empresa ?? '—'}</td>
                <td className="px-4 py-3 text-gray-600">{tipoClienteLabel(c.tipo)}</td>
                <td className="px-4 py-3 text-gray-600">{c.ciudad ?? '—'}</td>
                <td className="px-4 py-3">
                  {c.telefono_wa
                    ? <a href={`https://wa.me/${c.telefono_wa}`} target="_blank" rel="noopener noreferrer"
                        className="text-green-700 hover:underline font-mono text-xs">
                        {c.telefono_wa}
                      </a>
                    : <span className="text-gray-300">—</span>
                  }
                </td>
                <td className="px-4 py-3">
                  {c.correo
                    ? <a href={`mailto:${c.correo}`} className="text-[#003366] hover:underline text-xs">
                        {c.correo}
                      </a>
                    : <span className="text-gray-300">—</span>
                  }
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{formatDate(c.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
