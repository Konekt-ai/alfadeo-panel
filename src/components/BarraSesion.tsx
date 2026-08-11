'use client'

// Quién está operando y en qué plaza. Va en el header, visible siempre:
// si el inventario lo mueven varias personas al mismo tiempo (minuta 8),
// lo primero que hay que saber al llegar a la pantalla es quién eres tú.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { UserCircleIcon, BuildingStorefrontIcon, ChevronDownIcon } from '@heroicons/react/20/solid'
import { cambiarUsuario, cambiarSucursal } from '@/app/acciones-sesion'
import type { UsuarioPanel, Sucursal } from '@/lib/types'

export default function BarraSesion({
  usuarios,
  sucursales,
  usuario,
  sucursalId,
}: {
  usuarios: UsuarioPanel[]
  sucursales: Pick<Sucursal, 'id' | 'clave' | 'nombre'>[]
  usuario: string | null
  sucursalId: string | null
}) {
  const router = useRouter()
  const [pendiente, startTransition] = useTransition()
  const [abierto, setAbierto] = useState<'usuario' | 'plaza' | null>(null)

  const plaza = sucursales.find(s => s.id === sucursalId) ?? sucursales[0]

  const elegirUsuario = (nombre: string) => {
    setAbierto(null)
    startTransition(async () => {
      await cambiarUsuario(nombre)
      router.refresh()
    })
  }

  const elegirPlaza = (id: string) => {
    setAbierto(null)
    startTransition(async () => {
      await cambiarSucursal(id)
      router.refresh()
    })
  }

  const boton = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-200 hover:border-gray-300 transition-colors'

  return (
    <div className={`flex items-center gap-2 ${pendiente ? 'opacity-50' : ''}`}>
      {/* Plaza: el inventario es por plaza, así que esto cambia lo que ves */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setAbierto(abierto === 'plaza' ? null : 'plaza')}
          className={`${boton} text-gray-700`}
        >
          <BuildingStorefrontIcon className="w-4 h-4 text-gray-400" />
          <span className="hidden sm:inline">{plaza?.nombre ?? 'Sin plaza'}</span>
          <span className="sm:hidden">{plaza?.clave ?? '—'}</span>
          <ChevronDownIcon className="w-4 h-4 text-gray-400" />
        </button>
        {abierto === 'plaza' && (
          <div className="absolute right-0 mt-1 w-52 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1">
            {sucursales.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => elegirPlaza(s.id)}
                className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors ${
                  s.id === plaza?.id ? 'font-semibold text-[#003366]' : 'text-gray-700'
                }`}
              >
                {s.nombre}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Usuario: firma cada movimiento del kardex */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setAbierto(abierto === 'usuario' ? null : 'usuario')}
          className={`${boton} ${usuario ? 'text-gray-700' : 'text-amber-700 border-amber-300 bg-amber-50'}`}
        >
          <UserCircleIcon className={`w-4 h-4 ${usuario ? 'text-gray-400' : 'text-amber-500'}`} />
          <span>{usuario ?? 'Elegir usuario'}</span>
          <ChevronDownIcon className="w-4 h-4 text-gray-400" />
        </button>
        {abierto === 'usuario' && (
          <div className="absolute right-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1">
            <div className="px-4 py-2 text-xs text-gray-400 border-b border-gray-100">
              Firma los movimientos de inventario
            </div>
            {usuarios.length === 0 && (
              <div className="px-4 py-3 text-sm text-gray-400">
                No hay usuarios dados de alta.
              </div>
            )}
            {usuarios.map(u => (
              <button
                key={u.id}
                type="button"
                onClick={() => elegirUsuario(u.nombre)}
                className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors ${
                  u.nombre === usuario ? 'font-semibold text-[#003366]' : 'text-gray-700'
                }`}
              >
                {u.nombre}
                <span className="text-gray-400 font-normal"> · {u.rol}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
