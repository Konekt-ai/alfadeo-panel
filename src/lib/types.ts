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
  // Datos fiscales: se guardan una vez y se reutilizan en pedidos siguientes.
  rfc: string | null
  razon_social: string | null
  regimen_fiscal: string | null
  uso_cfdi: string | null
  cp_fiscal: string | null
  correo_facturacion: string | null
  requiere_factura: boolean | null
  sucursal_id: string | null
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
  // Desglose del catálogo farmacéutico. Lo llena el trigger
  // `productos_derivar_nombre` parseando `nombre`, y se puede corregir a mano.
  nombre_comercial: string | null
  nombre_generico: string | null
  concentracion: string | null      // "miligramos" en el lenguaje del cliente
  forma_farmaceutica: string | null // TAB, CAP, SOL INY...
  presentacion: string | null       // distingue C/12 de C/50 con la misma dosis
  codigo_barras: string | null
  laboratorio: string | null
  lote: string | null
  caducidad: string | null
  unidad: string | null
  categoria: string | null
  precio_base: number | null
  // tasa_iva es la fuente de verdad para facturar: 0 en medicamento de uso
  // humano, 0.16 en material de curación. `iva_exento` se mantiene por
  // compatibilidad, pero tasa 0% NO es lo mismo que exento.
  tasa_iva: number
  iva_exento: boolean
  controlado: boolean
  activo: boolean
}

// Plazas del grupo: son empresas independientes del mismo dueño.
export interface Sucursal {
  id: string
  clave: string           // 'GDL' | 'MTY'
  nombre: string
  razon_social: string | null
  rfc: string | null
  ciudad: string | null
  estado: string | null
  telefono_wa: string | null
  asesor_nombre: string | null
  es_matriz: boolean
  activo: boolean
}

// Fila de v_catalogo: producto + existencia desglosada por plaza.
export interface CatalogoRow {
  producto_id: string
  nombre: string
  nombre_comercial: string | null
  nombre_generico: string | null
  concentracion: string | null
  forma_farmaceutica: string | null
  presentacion: string | null
  laboratorio: string | null
  lote: string | null
  caducidad: string | null
  codigo_barras: string | null
  categoria: string | null
  tasa_iva: number
  controlado: boolean
  activo: boolean
  existencia_total: number
  existencia_gdl: number
  existencia_mty: number
  sucursales_con_stock: string | null
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

// Datos fiscales que captura el bot cuando el cliente pide factura.
export interface DatosFiscales {
  razon_social?: string
  rfc?: string
  cp?: string
  uso_cfdi?: string
  correo?: string
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
  // La pregunta va al final del flujo del bot, que es cuando el cliente
  // realmente la pide. null = no se llegó a preguntar.
  requiere_factura: boolean | null
  datos_fiscales: DatosFiscales | null
  sucursal_id: string | null
  notas: string | null
  created_at: string
  updated_at: string
  clientes: Cliente | null
  solicitud_items: SolicitudItem[]
}
