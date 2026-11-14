'use client'

// Alta rápida de cliente, dentro del cobro.
//
// El cliente llega al mostrador y no está registrado: en vez de mandar la
// venta como "mostrador" o salir a otra pantalla, se captura lo mínimo aquí
// y queda dado de alta en Clientes y seleccionado en la venta.
//
// Lo mínimo es el nombre. Empresa, tipo, teléfono y correo son opcionales;
// los datos fiscales y el crédito se completan después, con calma.

import { useState, useTransition } from 'react'
import { UserPlusIcon } from '@heroicons/react/20/solid'
import { tipoClienteLabel } from '@/lib/utils'
import type { TipoCliente } from '@/lib/types'
import { crearClienteRapido } from './acciones'

type ClienteCreado = NonNullable<Awaited<ReturnType<typeof crearClienteRapido>>['cliente']>

const TIPOS: TipoCliente[] = ['otro', 'medico', 'farmacia', 'clinica', 'hospital', 'distribuidor', 'gobierno']

export default function AltaRapidaCliente({
  nombreInicial,
  sucursalId,
  alGuardar,
  alCancelar,
}: {
  nombreInicial: string
  sucursalId: string | null
  alGuardar: (c: ClienteCreado) => void
  alCancelar: () => void
}) {
  const [nombre, setNombre] = useState(nombreInicial)
  const [empresa, setEmpresa] = useState('')
  const [tipo, setTipo] = useState<TipoCliente>('otro')
  const [telefono, setTelefono] = useState('')
  const [correo, setCorreo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [existente, setExistente] = useState<ClienteCreado | null>(null)
  const [guardando, startGuardar] = useTransition()

  const guardar = (aunqueExista = false) => {
    setError(null)
    startGuardar(async () => {
      const r = await crearClienteRapido(
        { nombre, empresa, tipo, telefono_wa: telefono, correo },
        sucursalId,
        aunqueExista,
      )
      if (r.error) { setError(r.error); return }
      if (r.existente) { setExistente(r.existente); return }
      if (r.cliente) alGuardar(r.cliente)
    })
  }

  const inputCls = 'w-full px-4 py-3 text-base border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366]'
  const labelCls = 'block text-sm font-medium text-gray-600 mb-1.5'

  return (
    <div className="border border-[#003366]/20 bg-[#003366]/[0.03] rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2 text-base font-semibold text-gray-900">
        <UserPlusIcon className="w-5 h-5 text-[#003366]" />
        Cliente nuevo
      </div>

      <div>
        <label className={labelCls}>Nombre *</label>
        <input
          value={nombre}
          onChange={e => { setNombre(e.target.value); setExistente(null) }}
          autoFocus
          autoComplete="off"
          placeholder="Persona de contacto"
          className={inputCls}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Empresa</label>
          <input
            value={empresa}
            onChange={e => { setEmpresa(e.target.value); setExistente(null) }}
            autoComplete="off"
            placeholder="Hospital, farmacia…"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Tipo</label>
          <select value={tipo} onChange={e => setTipo(e.target.value as TipoCliente)} className={inputCls + ' bg-white'}>
            {TIPOS.map(t => <option key={t} value={t}>{tipoClienteLabel(t)}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>WhatsApp</label>
          <input
            value={telefono}
            onChange={e => { setTelefono(e.target.value); setExistente(null) }}
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="10 dígitos"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Correo</label>
          <input
            value={correo}
            onChange={e => { setCorreo(e.target.value); setExistente(null) }}
            type="email"
            autoComplete="off"
            className={inputCls}
          />
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Ya estaba registrado: se ofrece usar ése en vez de duplicarlo. */}
      {existente ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-3">
          <p className="text-base text-amber-900">
            Ya hay un cliente registrado así:{' '}
            <strong>{existente.empresa ?? existente.nombre}</strong>
            {existente.empresa && existente.nombre !== existente.empresa && ` (${existente.nombre})`}.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => alGuardar(existente)}
              className="flex-1 sm:flex-none px-4 py-2.5 bg-[#003366] text-white text-base font-medium rounded-lg hover:bg-[#002244] transition-colors"
            >
              Usar este cliente
            </button>
            <button
              type="button"
              onClick={() => guardar(true)}
              disabled={guardando}
              className="flex-1 sm:flex-none px-4 py-2.5 border border-gray-300 text-gray-700 text-base font-medium rounded-lg hover:bg-white disabled:opacity-50 transition-colors"
            >
              Es otro, crearlo
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => guardar()}
            disabled={guardando || !nombre.trim()}
            className="flex-1 sm:flex-none px-5 py-2.5 bg-[#003366] text-white text-base font-medium rounded-lg hover:bg-[#002244] disabled:opacity-50 transition-colors"
          >
            {guardando ? 'Guardando…' : 'Guardar y usar'}
          </button>
          <button
            type="button"
            onClick={alCancelar}
            className="flex-1 sm:flex-none px-5 py-2.5 border border-gray-300 text-gray-700 text-base font-medium rounded-lg hover:bg-white transition-colors"
          >
            Cancelar
          </button>
        </div>
      )}
    </div>
  )
}
