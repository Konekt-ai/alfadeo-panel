import type {
  EstadoSolicitud, UrgenciaTipo, TipoCliente, CanalOrigen,
  TipoMovimiento, EstadoCobranza, FormaPago,
} from './types'

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

// --- Operación: POS, kardex y cobranza --------------------------------

export function pesos(n: number | null | undefined) {
  return (n ?? 0).toLocaleString('es-MX', {
    style: 'currency', currency: 'MXN', minimumFractionDigits: 2,
  })
}

// Fechas 'YYYY-MM-DD' de Postgres. Se fija el mediodía para que la zona
// horaria no reste un día al renderizar.
export function formatDia(fecha: string | null | undefined) {
  if (!fecha) return '—'
  const d = fecha.length === 10 ? new Date(fecha + 'T12:00:00') : new Date(fecha)
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function movimientoLabel(t: TipoMovimiento) {
  const map: Record<TipoMovimiento, string> = {
    entrada: 'Entrada', salida: 'Salida', ajuste: 'Ajuste',
    venta: 'Venta', devolucion: 'Devolución', merma: 'Merma',
    traslado_salida: 'Traslado · salida', traslado_entrada: 'Traslado · entrada',
  }
  return map[t] ?? t
}

export function movimientoColor(t: TipoMovimiento) {
  const map: Record<TipoMovimiento, string> = {
    entrada: 'bg-emerald-100 text-emerald-800',
    devolucion: 'bg-emerald-100 text-emerald-800',
    traslado_entrada: 'bg-teal-100 text-teal-800',
    salida: 'bg-orange-100 text-orange-800',
    venta: 'bg-blue-100 text-blue-800',
    traslado_salida: 'bg-amber-100 text-amber-800',
    merma: 'bg-red-100 text-red-800',
    ajuste: 'bg-gray-100 text-gray-700',
  }
  return map[t] ?? 'bg-gray-100 text-gray-700'
}

export function cobranzaLabel(e: EstadoCobranza) {
  const map: Record<EstadoCobranza, string> = {
    pagada: 'Pagada', pendiente: 'Pendiente', por_vencer: 'Por vencer',
    vencida: 'Vencida', cancelada: 'Cancelada',
  }
  return map[e] ?? e
}

export function cobranzaColor(e: EstadoCobranza) {
  const map: Record<EstadoCobranza, string> = {
    pagada: 'bg-emerald-100 text-emerald-800',
    pendiente: 'bg-blue-100 text-blue-800',
    por_vencer: 'bg-amber-100 text-amber-800',
    vencida: 'bg-red-100 text-red-800',
    cancelada: 'bg-gray-100 text-gray-500',
  }
  return map[e] ?? 'bg-gray-100 text-gray-700'
}

export function formaPagoLabel(f: FormaPago) {
  const map: Record<FormaPago, string> = {
    efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta',
    cheque: 'Cheque', credito: 'Crédito',
  }
  return map[f] ?? f
}

// Nombre para mostrar de un producto: el comercial va primero porque es
// como lo busca el equipo (minuta 20).
export function nombreProducto(p: {
  nombre_comercial?: string | null
  nombre_generico?: string | null
  nombre?: string | null
}) {
  return p.nombre_comercial || p.nombre_generico || p.nombre || '—'
}
