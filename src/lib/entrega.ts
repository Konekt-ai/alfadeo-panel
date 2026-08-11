// Tiempos de entrega (minuta 5 y 6).
//
//   "Generalmente envían por DHL, con entrega al día siguiente; sin
//    embargo, si el envío se realiza el viernes, normalmente se entrega
//    hasta el martes."
//
//   "Para los clientes nuevos es muy importante comunicar desde el
//    inicio los tiempos estimados de entrega."
//
// El bot ya calcula esto para contestarle al cliente. El panel lo repite
// aquí para poder comprometer una fecha al cerrar la venta y para que en
// la nota diga lo mismo que se dijo por WhatsApp: una sola respuesta.
//
// Sin dependencias ni fetch: es lógica pura y se puede probar sola.

// Asueto obligatorio del artículo 74 de la Ley Federal del Trabajo.
// Los que caen en lunes móvil se resuelven por regla, no por fecha fija.
function esFestivo(d: Date): boolean {
  const mes = d.getMonth() + 1
  const dia = d.getDate()
  const diaSemana = d.getDay()          // 0 domingo … 6 sábado
  const semanaDelMes = Math.ceil(dia / 7)

  // Fechas fijas
  if (mes === 1 && dia === 1) return true      // Año nuevo
  if (mes === 5 && dia === 1) return true      // Día del trabajo
  if (mes === 9 && dia === 16) return true     // Independencia
  if (mes === 12 && dia === 25) return true    // Navidad

  // Lunes móviles
  if (diaSemana === 1) {
    if (mes === 2 && semanaDelMes === 1) return true    // 1er lunes de febrero
    if (mes === 3 && semanaDelMes === 3) return true    // 3er lunes de marzo
    if (mes === 11 && semanaDelMes === 3) return true   // 3er lunes de noviembre
    // Transmisión del Poder Ejecutivo: 1er lunes de octubre cada 6 años.
    if (mes === 10 && semanaDelMes === 1 && d.getFullYear() % 6 === 0) return true
  }

  return false
}

export function esDiaHabil(d: Date): boolean {
  const ds = d.getDay()
  return ds !== 0 && ds !== 6 && !esFestivo(d)
}

function sumarDias(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

// Siguiente día hábil, sin contar el de hoy.
function siguienteHabil(d: Date): Date {
  let r = sumarDias(d, 1)
  while (!esDiaHabil(r)) r = sumarDias(r, 1)
  return r
}

/**
 * Fecha estimada de entrega para un envío que sale en `desde`.
 *
 * La regla del cliente es "al día siguiente, salvo el viernes que llega
 * el martes". El viernes tarda dos días hábiles y no uno porque la
 * recolección del viernes se procesa hasta el lunes.
 *
 * Si el envío sale en fin de semana o en día festivo, se toma como si
 * saliera el siguiente día hábil.
 */
export function fechaEntregaEstimada(desde: Date = new Date()): Date {
  let salida = new Date(desde)
  salida.setHours(12, 0, 0, 0)          // mediodía: evita saltos por zona horaria

  while (!esDiaHabil(salida)) salida = sumarDias(salida, 1)

  // Viernes = 5. Dos días hábiles; el resto de la semana, uno.
  const saltos = salida.getDay() === 5 ? 2 : 1

  let llegada = salida
  for (let i = 0; i < saltos; i++) llegada = siguienteHabil(llegada)

  return llegada
}

// 'YYYY-MM-DD' para guardar en Postgres, sin que la zona horaria mueva el día.
export function fechaISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/**
 * El texto que se le dice al cliente. Es la frase del punto 6: se dice
 * desde el principio y sin que la pidan.
 */
export function textoEntrega(desde: Date = new Date()): string {
  const llegada = fechaEntregaEstimada(desde)
  const fmt = llegada.toLocaleDateString('es-MX', {
    weekday: 'long', day: 'numeric', month: 'long',
  })
  return `Llega el ${fmt} (DHL, día siguiente hábil).`
}
