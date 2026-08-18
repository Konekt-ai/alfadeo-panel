import { avance } from './acciones'
import { usuarioActual } from '@/lib/usuario'
import Verificador from './Verificador'

export const dynamic = 'force-dynamic'

// Verificador de código de barras (minuta 22).
//
// Es la pantalla que desbloquea el punto de venta: hoy
// `productos.codigo_barras` está vacío, así que la pistola no encuentra
// nada. Aquí los empleados pasan cajas por el lector y les pegan su
// medicamento del catálogo. De paso funciona como verificador de precios.
export default async function VerificadorPage() {
  const a = await avance()

  return <Verificador avanceInicial={a} usuario={usuarioActual()} />
}
