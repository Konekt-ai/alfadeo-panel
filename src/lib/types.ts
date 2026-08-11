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

// =====================================================================
//  Operación: inventario en tiempo real, punto de venta y cobranza
//  (migración `reunion-operacion.sql`)
// =====================================================================

// Quién opera el panel. Sirve para firmar movimientos, no para autenticar.
export interface UsuarioPanel {
  id: string
  nombre: string
  iniciales: string | null
  rol: 'operador' | 'almacen' | 'ventas' | 'admin' | 'contabilidad'
  sucursal_id: string | null
  activo: boolean
}

// Un lote concreto en una plaza. Es una fila de `inventario`: el mismo
// producto aparece varias veces, una por lote y caducidad.
export interface Lote {
  lote: string | null
  caducidad: string | null
  ubicacion: string | null
  existencia: number
  sucursal?: string | null
  costo?: number | null
}

export type TipoMovimiento =
  | 'entrada' | 'salida' | 'ajuste' | 'venta' | 'devolucion'
  | 'merma' | 'traslado_salida' | 'traslado_entrada'

// Fila de v_movimientos: el kardex ya legible.
export interface Movimiento {
  id: string
  created_at: string
  tipo: TipoMovimiento
  cantidad: number              // con signo: + entra, - sale
  existencia_antes: number | null
  existencia_despues: number | null
  lote: string | null
  caducidad: string | null
  ubicacion: string | null
  motivo: string | null
  referencia_tipo: string | null
  referencia_id: string | null
  usuario: string | null
  producto_id: string
  producto: string
  nombre_generico: string | null
  concentracion: string | null
  presentacion: string | null
  sucursal_id: string | null
  sucursal: string | null
  sucursal_nombre: string | null
}

// Fila de buscar_productos_pos(): lo que necesita la caja para cobrar.
export interface ProductoPOS {
  producto_id: string
  nombre: string
  nombre_comercial: string | null
  nombre_generico: string | null
  concentracion: string | null
  forma_farmaceutica: string | null
  presentacion: string | null
  laboratorio: string | null
  codigo_barras: string | null
  precio_base: number | null
  tasa_iva: number
  controlado: boolean
  existencia: number          // en la plaza seleccionada
  existencia_otras: number    // en las demás plazas (minuta 28)
  score: number
  lotes: Lote[]
}

export type FormaPago = 'efectivo' | 'transferencia' | 'tarjeta' | 'cheque' | 'credito'
export type EstadoVenta = 'borrador' | 'cerrada' | 'cancelada'
export type FacturaEmisor = 'interno' | 'aspel' | 'contalink' | 'otro'

export interface VentaItem {
  id: string
  venta_id: string
  producto_id: string | null
  descripcion: string
  cantidad: number
  precio_unitario: number
  descuento_pct: number
  // Congelada al vender: si mañana cambia la tasa del catálogo, esta venta
  // no se altera. La mayoría de sus productos va en 0 (minuta 3).
  tasa_iva: number
  subtotal: number
  iva: number
  total: number
  costo_unitario: number | null
  lotes: Lote[]
  posicion: number
}

export interface Venta {
  id: string
  folio: string | null
  sucursal_id: string
  cliente_id: string | null
  solicitud_id: string | null
  cotizacion_id: string | null
  estado: EstadoVenta
  forma_pago: FormaPago
  dias_credito: number
  fecha: string
  fecha_vencimiento: string | null
  fecha_entrega: string | null
  subtotal: number
  iva: number
  total: number
  requiere_factura: boolean | null
  factura_emisor: FacturaEmisor | null
  factura_serie: string | null
  factura_folio: string | null
  factura_uuid: string | null
  facturado_en: string | null
  usuario: string | null
  canal: 'pos' | 'panel' | 'whatsapp' | 'web'
  notas: string | null
  created_at: string
}

export type EstadoCobranza = 'pagada' | 'pendiente' | 'por_vencer' | 'vencida' | 'cancelada'

// Fila de v_ventas_cobranza: la venta con lo que ya se cobró y lo que falta.
export interface VentaCobranza {
  venta_id: string
  folio: string | null
  fecha: string
  fecha_vencimiento: string | null
  fecha_entrega: string | null
  estado: EstadoVenta
  forma_pago: FormaPago
  dias_credito: number
  total: number
  requiere_factura: boolean | null
  factura_emisor: FacturaEmisor | null
  factura_uuid: string | null
  canal: string
  usuario: string | null
  cliente_id: string | null
  cliente_nombre: string | null
  cliente_empresa: string | null
  portal_pagos_url: string | null
  factura_externa: string | null
  sucursal_id: string | null
  sucursal: string | null
  pagado: number
  saldo: number
  ultimo_pago: string | null
  estado_cobranza: EstadoCobranza
  dias_vencida: number
}

// Fila de v_estado_cuenta_cliente (minuta 30).
export interface EstadoCuentaCliente {
  cliente_id: string
  nombre: string | null
  empresa: string | null
  tipo: TipoCliente | null
  telefono_wa: string | null
  correo: string | null
  dias_credito: number
  limite_credito: number | null
  portal_pagos_url: string | null
  factura_externa: string | null
  ventas: number
  facturado: number
  pagado: number
  saldo: number
  saldo_vencido: number
  facturas_vencidas: number
  dias_mas_atrasado: number | null
  ultimo_pago: string | null
  ultima_venta: string | null
}

export type MetodoPago = 'efectivo' | 'transferencia' | 'tarjeta' | 'cheque' | 'compensacion'

export interface Pago {
  id: string
  venta_id: string | null
  cliente_id: string | null
  monto: number
  fecha: string
  metodo: MetodoPago
  referencia: string | null
  // 'manual' es la fuente de verdad; el SAT sólo confirma (minuta 32).
  origen: 'manual' | 'sat' | 'banco'
  usuario: string | null
  notas: string | null
  created_at: string
}

export type TipoAlerta = 'cobranza_vencida' | 'cobranza_por_vencer' | 'caducidad' | 'stock_bajo'

// Fila de v_alertas: lo que hay que perseguir hoy (minuta 31).
export interface Alerta {
  tipo: TipoAlerta
  prioridad: 'alta' | 'media' | 'baja'
  referencia_id: string | null
  referencia_tipo: string | null
  titulo: string
  detalle: string
  monto: number | null
  fecha: string | null
  sucursal: string | null
}

export type EstadoTraslado = 'borrador' | 'en_transito' | 'recibido' | 'cancelado'

export interface Traslado {
  id: string
  folio: string | null
  origen_id: string
  destino_id: string
  estado: EstadoTraslado
  paqueteria: string | null
  guia: string | null
  fecha_envio: string | null
  fecha_estimada: string | null
  fecha_recepcion: string | null
  usuario: string | null
  notas: string | null
  created_at: string
}

export interface TrasladoItem {
  id: string
  traslado_id: string
  producto_id: string
  cantidad: number
  lote: string | null
  caducidad: string | null
  lotes: Lote[]
  posicion: number
}

export type EstadoCompra = 'borrador' | 'recibida' | 'cancelada'

export interface Compra {
  id: string
  folio: string | null
  proveedor_id: string | null
  sucursal_id: string
  fecha: string
  estado: EstadoCompra
  subtotal: number
  iva: number
  total: number
  moneda: string
  factura_serie: string | null
  factura_folio: string | null
  factura_uuid: string | null
  emisor_rfc: string | null
  emisor_nombre: string | null
  usuario: string | null
  notas: string | null
  created_at: string
}

export interface CompraItem {
  id: string
  compra_id: string
  producto_id: string | null
  descripcion: string
  clave_prov: string | null
  codigo_barras: string | null
  cantidad: number
  costo_unitario: number
  tasa_iva: number
  lote: string | null
  caducidad: string | null
  ubicacion: string | null
  posicion: number
}

// Línea de carrito del POS, antes de mandarla a pos_registrar_venta().
export interface LineaPOS {
  producto_id: string
  descripcion: string
  cantidad: number
  precio_unitario: number
  descuento_pct: number
  tasa_iva: number
  existencia: number
  controlado: boolean
}
