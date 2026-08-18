import Link from 'next/link'
import { sql } from '@/lib/db'
import type { Cliente } from '@/lib/types'
import { tipoClienteLabel, formatDate } from '@/lib/utils'
import { PhoneIcon, EnvelopeIcon } from '@heroicons/react/20/solid'

export const dynamic = 'force-dynamic'

export default async function ClientesPage() {
  const { data: clientes, error } = await sql<Cliente>(
    `select * from clientes order by created_at desc`
  )

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Clientes</h1>
        <p className="text-base text-gray-500 mt-1">{clientes.length} registrados</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-6 text-base">
          Error al cargar: {error.message}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-base min-w-[820px]">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Nombre</th>
              <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Empresa</th>
              <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Tipo</th>
              <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Ciudad</th>
              <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Crédito</th>
              <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Contacto</th>
              <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Registro</th>
              <th className="px-5 py-4" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {(!clientes || clientes.length === 0) && (
              <tr>
                <td colSpan={8} className="text-center py-20 text-gray-400 text-base">
                  No hay clientes registrados aún.
                </td>
              </tr>
            )}
            {clientes?.map((c: Cliente & { dias_credito?: number | null }) => (
              <tr key={c.id} className="hover:bg-gray-50/60 transition-colors group">
                <td className="px-5 py-4 font-medium text-gray-900">{c.nombre ?? '—'}</td>
                <td className="px-5 py-4 text-gray-600">{c.empresa ?? '—'}</td>
                <td className="px-5 py-4">
                  <span className="text-sm font-medium text-gray-600 bg-gray-100 px-2.5 py-1 rounded-md">
                    {tipoClienteLabel(c.tipo)}
                  </span>
                </td>
                <td className="px-5 py-4 text-gray-500">{c.ciudad ?? '—'}</td>
                {/* El plazo pactado es lo que decide cuándo vence una venta
                    a crédito (minuta 34). */}
                <td className="px-5 py-4">
                  {c.dias_credito && c.dias_credito > 0 ? (
                    <span className="text-sm font-medium text-amber-800 bg-amber-50 px-2.5 py-1 rounded-md whitespace-nowrap">
                      {c.dias_credito} días
                    </span>
                  ) : (
                    <span className="text-sm text-gray-400">Contado</span>
                  )}
                </td>
                <td className="px-5 py-4">
                  <div className="flex flex-col gap-1.5">
                    {c.telefono_wa && (
                      <a href={`https://wa.me/${c.telefono_wa}`} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-700 hover:text-teal-800 transition-colors">
                        <PhoneIcon className="w-4 h-4" />
                        {c.telefono_wa}
                      </a>
                    )}
                    {c.correo && (
                      <a href={`mailto:${c.correo}`}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-[#003366] hover:underline transition-colors">
                        <EnvelopeIcon className="w-4 h-4" />
                        {c.correo}
                      </a>
                    )}
                    {!c.telefono_wa && !c.correo && <span className="text-gray-400 text-sm">—</span>}
                  </div>
                </td>
                <td className="px-5 py-4 text-gray-400 text-sm whitespace-nowrap">{formatDate(c.created_at)}</td>
                <td className="px-5 py-4">
                  <Link href={`/cobranza/${c.id}`}
                    className="text-sm font-medium text-[#003366] md:opacity-0 md:group-hover:opacity-100 transition-opacity hover:underline whitespace-nowrap">
                    Estado de cuenta
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}
