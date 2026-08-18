// Acceso a PostgreSQL. La base vive en la misma computadora que el panel:
// no hay nube de por medio.
//
// Sustituye a la capa de Supabase. La forma de las consultas cambia -- SQL
// en vez del constructor de consultas -- pero la forma de la RESPUESTA se
// mantiene a proposito:
//
//     const { data, error } = await sql('select ...')
//
// Asi las paginas siguen pintando su recuadro de error igual que antes, y
// un fallo de base no tumba la pantalla completa.
//
// Solo servidor. Nunca importar esto desde un componente con 'use client'.

import { Pool, types } from 'pg'

// --------------------------------------------------------------- tipos ---
// node-postgres devuelve numeric/int8 como STRING para no perder precision.
// En este panel los numeric son dinero y piezas, con dos o tres decimales:
// caben de sobra en un double. Se convierten aqui para que las paginas no
// tengan que andar haciendo Number() en cada campo.
types.setTypeParser(types.builtins.NUMERIC, (v) => (v === null ? null : parseFloat(v)))
types.setTypeParser(types.builtins.INT8,    (v) => (v === null ? null : parseInt(v, 10)))

// Las fechas (date) se dejan como texto 'YYYY-MM-DD'. Si se convirtieran a
// Date, la zona horaria le restaria un dia al renderizar: una caducidad de
// 2027-12-01 se veria como 30 de noviembre.
types.setTypeParser(types.builtins.DATE, (v) => v)

// ----------------------------------------------------------------- pool ---
// En desarrollo, Next recarga los modulos en cada cambio. Sin el singleton
// global cada recarga abriria un pool nuevo y Postgres se quedaria sin
// conexiones a los pocos minutos.
const globalParaPool = globalThis as unknown as { _alfadeoPool?: Pool }

// El pool se crea en la PRIMERA consulta, no al importar el modulo. Importa:
// `next build` importa cada pagina para analizarla, y si el pool se creara al
// importar, compilar exigiria tener la base ya configurada. El instalador
// compila ANTES de que exista DATABASE_URL, y no tiene por que fallar por eso.
function obtenerPool(): Pool {
  if (globalParaPool._alfadeoPool) return globalParaPool._alfadeoPool

  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'Falta DATABASE_URL en .env.local. En la computadora del mostrador lo ' +
      'escribe instalacion\instalar-postgres.ps1.'
    )
  }

  const p = new Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  })
  // Sin este manejador, un corte de conexion mata el proceso de Node entero.
  p.on('error', (e) => console.error('[db] error en conexion inactiva:', e.message))

  globalParaPool._alfadeoPool = p
  return p
}

// ------------------------------------------------------------ consultas ---

export interface Resultado<T> {
  data: T[]
  error: { message: string } | null
}

/**
 * Consulta que NO lanza. Devuelve `{ data, error }` para que la pagina
 * decida que pintar. Es la forma normal de leer desde un server component.
 */
export async function sql<T = Record<string, unknown>>(
  consulta: string,
  params: unknown[] = []
): Promise<Resultado<T>> {
  try {
    const r = await obtenerPool().query(consulta, params)
    return { data: r.rows as T[], error: null }
  } catch (e) {
    return { data: [], error: { message: mensajeDeError(e) } }
  }
}

/** Una sola fila, o null. Mismo contrato de error que `sql`. */
export async function uno<T = Record<string, unknown>>(
  consulta: string,
  params: unknown[] = []
): Promise<{ data: T | null; error: { message: string } | null }> {
  const r = await sql<T>(consulta, params)
  return { data: r.data[0] ?? null, error: r.error }
}

/**
 * Consulta que SI lanza. Para server actions, donde el error se atrapa
 * arriba y se le regresa al formulario.
 */
export async function qx<T = Record<string, unknown>>(
  consulta: string,
  params: unknown[] = []
): Promise<T[]> {
  const r = await obtenerPool().query(consulta, params)
  return r.rows as T[]
}

/**
 * Varias sentencias en UNA transaccion. Si algo truena, no queda nada a
 * medias.
 *
 * Las funciones de la base (pos_registrar_venta, enviar_traslado...) ya son
 * atomicas por si solas; esto es para cuando hay que encadenar varias.
 */
export async function enTransaccion<T>(
  fn: (ejecutar: <R = Record<string, unknown>>(consulta: string, params?: unknown[]) => Promise<R[]>) => Promise<T>
): Promise<T> {
  const cliente = await obtenerPool().connect()
  try {
    await cliente.query('begin')
    const resultado = await fn(async (consulta, params = []) => {
      const r = await cliente.query(consulta, params)
      return r.rows as never[]
    })
    await cliente.query('commit')
    return resultado
  } catch (e) {
    await cliente.query('rollback').catch(() => {})
    throw e
  } finally {
    cliente.release()
  }
}

// ---------------------------------------------------------------- errores -
// Los `raise exception` de las funciones plpgsql ya vienen redactados en
// espanol ("Existencia insuficiente: hay 3 y se intentan sacar 5."). Se
// pasan tal cual. Lo que se traduce son los errores de infraestructura,
// que en crudo no le dicen nada a quien esta en el mostrador.
function mensajeDeError(e: unknown): string {
  const err = e as { code?: string; message?: string; table?: string }
  const codigo = err?.code

  if (codigo === 'ECONNREFUSED' || codigo === 'ENOTFOUND') {
    return 'No se pudo conectar a la base de datos. Revisa que el servicio de PostgreSQL este arriba (comando: estado).'
  }
  if (codigo === '42P01') {
    return `${err.message} -- falta correr las migraciones de la base (comando: instalar-base).`
  }
  if (codigo === '42883') {
    return `${err.message} -- falta correr las migraciones de la base (comando: instalar-base).`
  }
  if (codigo === '28P01') {
    return 'Contrasena incorrecta al conectar a la base. Revisa DATABASE_URL en .env.local.'
  }
  if (codigo === '3D000') {
    return 'La base de datos no existe todavia. Corre instalacion\\instalar-base.ps1.'
  }
  return err?.message ?? String(e)
}

/**
 * ¿El error es porque falta una tabla/función, es decir, falta migrar?
 * Las páginas lo usan para decidir si muestran la ayuda de migración.
 */
export function faltaMigracion(mensaje: string | null | undefined): boolean {
  if (!mensaje) return false
  return /relation .* does not exist|function .* does not exist|falta correr las migraciones|no existe todavia|falta database_url/i
    .test(mensaje)
}
