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

  type FilaCliente = Cliente & { dias_credito?: number | null }

  // Compartidos por la tabla de escritorio y las tarjetas del celular.
  const credito = (c: FilaCliente) =>
    c.dias_credito && c.dias_credito > 0 ? (
      <span className="text-sm font-medium text-amber-800 bg-amber-50 px-2.5 py-1 rounded-md whitespace-nowrap">
        {c.dias_credito} días
      </span>
    ) : (
      <span className="text-sm text-gray-400">Contado</span>
    )

  const contacto = (c: FilaCliente) => (
    <div className="flex flex-col gap-1.5 min-w-0">
      {c.telefono_wa && (
        <a href={`https://wa.me/${c.telefono_wa}`} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 py-1 lg:py-0 text-sm font-medium text-teal-700 hover:text-teal-800 transition-colors">
          <PhoneIcon className="w-4 h-4 shrink-0" />
          {c.telefono_wa}
        </a>
      )}
      {c.correo && (
        <a href={`mailto:${c.correo}`}
          className="inline-flex items-center gap-1.5 py-1 lg:py-0 text-sm font-medium text-[#003366] hover:underline transition-colors break-all">
          <EnvelopeIcon className="w-4 h-4 shrink-0" />
          {c.correo}
        </a>
      )}
      {!c.telefono_wa && !c.correo && <span className="text-gray-400 text-sm">—</span>}
    </div>
  )

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Clientes</h1>
        <p className="text-base text-gray-500 mt-1">{clientes.length} registrados</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-6 text-base">
          Error al cargar: {error.message}
        </div>
      )}

      {/* Celular y tablet: una tarjeta por cliente. No es enlace completo
          porque trae dentro los de WhatsApp y correo. */}
      <div className="lg:hidden">
        {(!clientes || clientes.length === 0) && (
          <div className="bg-white border border-gray-200 rounded-xl text-center py-16 text-gray-400 text-base">
            No hay clientes registrados aún.
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {clientes?.map((c: FilaCliente) => (
            <div key={c.id} className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 break-words">{c.nombre ?? '—'}</div>
                  {c.empresa && <div className="text-sm text-gray-500 mt-0.5 break-words">{c.empresa}</div>}
                </div>
                <div className="shrink-0 text-right">{credito(c)}</div>
              </div>
              <div className="flex items-center gap-x-3 gap-y-2 flex-wrap mt-3">
                <span className="text-sm font-medium text-gray-600 bg-gray-100 px-2.5 py-1 rounded-md">
                  {tipoClienteLabel(c.tipo)}
                </span>
                {c.ciudad && <span className="text-sm text-gray-500">{c.ciudad}</span>}
                <span className="text-sm text-gray-400 ml-auto whitespace-nowrap">{formatDate(c.created_at)}</span>
              </div>
              <div className="mt-3 pt-3 border-t border-gray-100 flex items-end justify-between gap-3">
                {contacto(c)}
                <Link href={`/cobranza/${c.id}`}
                  className="shrink-0 inline-flex items-center px-3 py-2 -mr-1 text-sm font-medium text-[#003366] rounded-lg hover:bg-[#003366]/5 whitespace-nowrap">
                  Estado de cuenta
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Escritorio: tabla. */}
      <div className="hidden lg:block bg-white border border-gray-200 rounded-xl overflow-hidden">
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
            {clientes?.map((c: FilaCliente) => (
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
                <td className="px-5 py-4">{credito(c)}</td>
                <td className="px-5 py-4">{contacto(c)}</td>
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
