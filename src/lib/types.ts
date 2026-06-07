export type TipoCliente = 'hospital' | 'clinica' | 'farmacia' | 'gobierno' | 'distribuidor' | 'medico' | 'otro'
export type CanalOrigen = 'whatsapp' | 'web'
export type EstadoSolicitud = 'nueva' | 'en_revision' | 'cotizada' | 'enviada' | 'aceptada' | 'rechazada' | 'facturada' | 'cancelada'
export type UrgenciaTipo = 'normal' | 'urgente' | 'programada'

export interface Cliente {
  id: string
  nombre: string | null
  empresa: string | null
  tipo: TipoCliente | null
  ciudad: string | null
  telefono_wa: string | null
  correo: string | null
  created_at: string
}

export interface SolicitudItem {
  id: string
  producto_id: string | null
  descripcion_libre: string | null
  cantidad: number | null
  unidad: string | null
  nota: string | null
}

export interface Producto {
  id: string
  nombre: string
  laboratorio: string | null
  presentacion: string | null
  unidad: string | null
  precio_base: number | null
  iva_exento: boolean
  activo: boolean
}

export interface CotizacionItem {
  id: string
  producto_id: string | null
  descripcion: string
  cantidad: number
  unidad: string | null
  precio_unitario: number
  iva_exento: boolean
  subtotal: number
  sujeto_confirmacion: boolean
  posicion: number
}

export interface Cotizacion {
  id: string
  folio: string
  solicitud_id: string | null
  cliente_id: string | null
  estado: string
  vigencia_dias: number
  condiciones: string | null
  notas: string | null
  subtotal: number
  iva: number
  total: number
  pdf_url: string | null
  created_at: string
  cotizacion_items: CotizacionItem[]
}

export interface Solicitud {
  id: string
  folio: number
  cliente_id: string | null
  canal: CanalOrigen
  estado: EstadoSolicitud
  urgencia: UrgenciaTipo
  ciudad_entrega: string | null
  responsable: string | null
  requiere_humano: boolean
  notas: string | null
  created_at: string
  updated_at: string
  clientes: Cliente | null
  solicitud_items: SolicitudItem[]
}
