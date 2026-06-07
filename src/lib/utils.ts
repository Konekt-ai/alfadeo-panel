import type { EstadoSolicitud, UrgenciaTipo, TipoCliente, CanalOrigen } from './types'

export function estadoLabel(e: EstadoSolicitud) {
  const map: Record<EstadoSolicitud, string> = {
    nueva: 'Nueva', en_revision: 'En revisión', cotizada: 'Cotizada',
    enviada: 'Enviada', aceptada: 'Aceptada', rechazada: 'Rechazada',
    facturada: 'Facturada', cancelada: 'Cancelada',
  }
  return map[e] ?? e
}

export function estadoColor(e: EstadoSolicitud) {
  const map: Record<EstadoSolicitud, string> = {
    nueva: 'bg-blue-100 text-blue-800',
    en_revision: 'bg-yellow-100 text-yellow-800',
    cotizada: 'bg-purple-100 text-purple-800',
    enviada: 'bg-indigo-100 text-indigo-800',
    aceptada: 'bg-green-100 text-green-800',
    rechazada: 'bg-red-100 text-red-800',
    facturada: 'bg-gray-100 text-gray-800',
    cancelada: 'bg-gray-100 text-gray-500',
  }
  return map[e] ?? 'bg-gray-100 text-gray-800'
}

export function urgenciaColor(u: UrgenciaTipo) {
  const map: Record<UrgenciaTipo, string> = {
    normal: 'bg-gray-100 text-gray-600',
    urgente: 'bg-red-100 text-red-700',
    programada: 'bg-cyan-100 text-cyan-700',
  }
  return map[u] ?? 'bg-gray-100 text-gray-600'
}

export function tipoClienteLabel(t: TipoCliente | null) {
  if (!t) return '—'
  const map: Record<TipoCliente, string> = {
    hospital: 'Hospital', clinica: 'Clínica', farmacia: 'Farmacia',
    gobierno: 'Gobierno', distribuidor: 'Distribuidor', medico: 'Médico', otro: 'Otro',
  }
  return map[t] ?? t
}

export function canalLabel(c: CanalOrigen) {
  return c === 'whatsapp' ? 'WhatsApp' : 'Web'
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}
