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
  categoria: string | null
  precio_base: number | null
  iva_exento: boolean
  activo: boolean
}

export type OrigenCompra = 'inventario' | 'proveedor'

// Una fila de v_opciones_compra: de dónde se puede surtir un producto.
export interface OpcionCompra {
  producto_id: string
  origen: OrigenCompra
  proveedor_id: string | null
  fuente_nombre: string
  costo: number | null
  existencia: number | null
  en_stock: boolean | null
  caducidad: string | null
  moq: number | null
  fecha_precio: string
  match_score: number | null
}

export type MetodoIngesta = 'manual' | 'import' | 'scrape' | 'api'
export type EstadoMatch = 'pendiente' | 'auto' | 'confirmado' | 'descartado'

export interface Proveedor {
  id: string
  nombre: string
  slug: string
  metodo_ingesta: MetodoIngesta
  portal_url: string | null
  credencial_ref: string | null
  moneda: string | null
  dias_entrega: number | null
  activo: boolean
  notas: string | null
  created_at: string
  updated_at: string
}

export interface ProveedorPrecio {
  id: string
  proveedor_id: string
  sku_proveedor: string | null
  codigo_barras: string | null
  nombre_prov: string
  laboratorio: string | null
  presentacion: string | null
  precio: number | null
  existencia: number | null
  en_stock: boolean | null
  caducidad: string | null
  moq: number | null
  origen: string
  fecha_precio: string
  producto_id: string | null
  match_estado: EstadoMatch
  match_score: number | null
}

// Regla de margen (tabla margenes). Scope null = aplica a todo.
export interface Margen {
  id: string
  tipo_cliente: TipoCliente | null
  categoria: string | null
  producto_id: string | null
  margen_pct: number
  prioridad: number
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
