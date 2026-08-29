import Link from 'next/link'
import {
  ArrowLeftIcon, InformationCircleIcon, CheckCircleIcon,
} from '@heroicons/react/20/solid'
import { sql, faltaMigracion } from '@/lib/db'
import { nombreProducto } from '@/lib/utils'
import Duplicados, { type FilaDuplicado, type GrupoDuplicado } from './Duplicados'

export const dynamic = 'force-dynamic'

// Productos repetidos (minuta 17, 22).
//
// El catálogo llegó a tener 281 productos para 134 nombres reales: alguien
// daba de alta un producto que ya existía y quedaban dos, cada uno con su
// pedazo de existencia y de historial. La migración `catalogo-limpio.sql` ya
// lo dejó en 128, pero el problema se repite en cuanto vuelva a pasar. Esta
// pantalla es para verlo y resolverlo sin abrir la base.
//
// El agrupado se hace aquí y no en SQL porque son dos choques distintos que
// hay que presentar por separado: mismo nombre (se fusionan) y mismo código
// de barras (a veces son productos DISTINTOS y hay que desempatar).

const num = (v: number | null | undefined) => Number(v ?? 0)

// `sugerido_destino` se pide con ::text porque la vista puede entregarlo como
// el uuid del producto a conservar o como una bandera por renglón. Se aceptan
// las dos formas; si ninguna aplica, manda el historial.
function esSugerido(f: FilaDuplicado): boolean {
  const v = f.sugerido_destino
  return v === f.producto_id || v === 'true' || v === 't'
}

function armarGrupo(
  clave: string,
  tipo: 'nombre' | 'codigo',
  etiqueta: string | null,
  filas: FilaDuplicado[],
): GrupoDuplicado {
  // El que más historial trae va primero: es el que conviene conservar,
  // porque es al que apuntan más ventas y movimientos.
  const ordenadas = [...filas].sort((a, b) =>
    num(b.historial) - num(a.historial) ||
    num(b.stock) - num(a.stock) ||
    nombreProducto(a).localeCompare(nombreProducto(b))
  )
  const marcado = ordenadas.find(esSugerido)
  return {
    clave,
    tipo,
    titulo: etiqueta ?? nombreProducto(ordenadas[0]),
    destinoSugerido: (marcado ?? ordenadas[0]).producto_id,
    filas: ordenadas,
  }
}

function agrupar(filas: FilaDuplicado[]): GrupoDuplicado[] {
  // (a) Choques de código de barras. Van primero porque son los que pueden
  //     esconder dos productos distintos con el mismo código.
  const porCodigo = new Map<string, FilaDuplicado[]>()
  for (const f of filas) {
    if (num(f.copias_mismo_codigo) > 1 && f.codigo_barras) {
      porCodigo.set(f.codigo_barras, [...(porCodigo.get(f.codigo_barras) ?? []), f])
    }
  }

  // (b) Choques de nombre.
  const porNombre = new Map<string, FilaDuplicado[]>()
  for (const f of filas) {
    if (num(f.copias_mismo_nombre) > 1) {
      const clave = f.clave_nombre ?? nombreProducto(f).toLowerCase()
      porNombre.set(clave, [...(porNombre.get(clave) ?? []), f])
    }
  }

  const firma = (fs: FilaDuplicado[]) => fs.map(f => f.producto_id).sort().join('|')

  const gruposCodigo = Array.from(porCodigo.entries())
    .filter(([, fs]) => fs.length > 1)
    .map(([codigo, fs]) => armarGrupo(`codigo:${codigo}`, 'codigo', codigo, fs))

  // Cuando las mismas copias chocan por nombre Y por código, se enseña una
  // sola tarjeta: la de código, que es la que trae el aviso fuerte.
  const yaEnCodigo = new Set(Array.from(porCodigo.values()).filter(fs => fs.length > 1).map(firma))

  const gruposNombre = Array.from(porNombre.entries())
    .filter(([, fs]) => fs.length > 1 && !yaEnCodigo.has(firma(fs)))
    .map(([clave, fs]) => armarGrupo(`nombre:${clave}`, 'nombre', null, fs))

  // Los que necesitan decisión humana arriba: choque de código con existencia
  // en más de uno. Es lo que hay que resolver hoy, no mañana.
  const urgente = (g: GrupoDuplicado) =>
    g.tipo === 'codigo' && g.filas.filter(f => num(f.stock) > 0).length > 1

  return [...gruposCodigo, ...gruposNombre].sort((a, b) =>
    Number(urgente(b)) - Number(urgente(a)) ||
    (a.tipo === b.tipo ? 0 : a.tipo === 'codigo' ? -1 : 1) ||
    b.filas.length - a.filas.length ||
    a.titulo.localeCompare(b.titulo)
  )
}

export default async function DuplicadosPage({
  searchParams,
}: {
  searchParams: Promise<{ ver?: string }>
}) {
  const params = await searchParams
  const ver = params.ver === 'nombre' || params.ver === 'codigo' ? params.ver : undefined

  const { data, error } = await sql<FilaDuplicado>(
    `select producto_id, nombre, nombre_comercial, nombre_generico,
            codigo_barras, activo, stock, historial, clave_nombre,
            copias_mismo_nombre, copias_mismo_codigo,
            sugerido_destino::text as sugerido_destino
       from v_productos_duplicados
      order by clave_nombre, historial desc nulls last, nombre`
  )

  const todos = agrupar(data)
  const grupos = ver ? todos.filter(g => g.tipo === ver) : todos

  // "Copias de más" es el número que le importa a la gente: cuántos renglones
  // sobran en el catálogo, no cuántos grupos hay.
  const copiasDeMas = todos.reduce((s, g) => s + g.filas.length - 1, 0)
  const conDecisionHumana = todos.filter(
    g => g.tipo === 'codigo' && g.filas.filter(f => num(f.stock) > 0).length > 1
  ).length

  const url = (v?: string) => `/inventario/duplicados${v ? `?ver=${v}` : ''}`
  const chip = (activo: boolean) =>
    `px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors ${
      activo ? 'text-white' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
    }`

  return (
    <div className="p-8">
      <div className="mb-8">
        <Link
          href="/inventario"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors mb-3"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          Inventario
        </Link>
        <h1 className="text-2xl font-semibold text-gray-900">Productos duplicados</h1>
        <p className="text-base text-gray-500 mt-1">
          {error
            ? 'No se pudo leer la lista de productos repetidos.'
            : todos.length === 0
            ? 'El catálogo no tiene productos repetidos.'
            : `${todos.length} ${todos.length === 1 ? 'grupo repetido' : 'grupos repetidos'} · ` +
              `${copiasDeMas} ${copiasDeMas === 1 ? 'copia de más' : 'copias de más'} en el catálogo`}
          {conDecisionHumana > 0 &&
            ` · ${conDecisionHumana} ${conDecisionHumana === 1 ? 'necesita' : 'necesitan'} decisión de una persona`}
        </p>
      </div>

      {/* Lo que la gente necesita saber antes de apretar el botón. */}
      <div className="flex items-start gap-2.5 bg-blue-50 border border-blue-200 text-blue-900 rounded-xl p-4 mb-6 text-base">
        <InformationCircleIcon className="w-5 h-5 mt-0.5 shrink-0" />
        <span>
          Fusionar <strong className="font-semibold">no borra ventas</strong>: las ventas y
          los movimientos viejos de las copias siguen apuntando al producto que se
          conserva, y su existencia se le suma.
        </span>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-6 text-base">
          {error.message}
          {faltaMigracion(error.message) && (
            <p className="mt-2 text-sm">
              Falta preparar la base. En esa computadora corre{' '}
              <code className="font-mono">instalacion\instalar-base.ps1</code>.
            </p>
          )}
        </div>
      )}

      {todos.length > 0 && (
        <div className="flex gap-2 flex-wrap items-center mb-6">
          <span className="text-sm text-gray-500 mr-1 font-medium">Ver:</span>
          <a
            href={url()}
            className={chip(!ver)}
            style={!ver ? { background: '#003366', borderColor: '#003366' } : undefined}
          >
            Todos
          </a>
          <a
            href={url('codigo')}
            className={chip(ver === 'codigo')}
            style={ver === 'codigo' ? { background: '#003366', borderColor: '#003366' } : undefined}
          >
            Mismo código
          </a>
          <a
            href={url('nombre')}
            className={chip(ver === 'nombre')}
            style={ver === 'nombre' ? { background: '#003366', borderColor: '#003366' } : undefined}
          >
            Mismo nombre
          </a>
        </div>
      )}

      {grupos.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl">
          <div className="text-center py-20 text-gray-400 text-base px-6">
            {/* Con la consulta caída no se sabe nada del catálogo: decir que
                está limpio sería mentir justo debajo del recuadro rojo. */}
            {error ? (
              <p className="text-gray-600 text-lg font-medium">
                No se pudo leer el catálogo. El detalle está en el recuadro rojo de arriba.
              </p>
            ) : todos.length > 0 ? (
              <>
                <p className="text-gray-600 text-lg font-medium">
                  No hay duplicados de ese tipo.
                </p>
                <p className="mt-2">
                  Sí hay otros repetidos.{' '}
                  <a href={url()} className="text-[#003366] font-medium hover:underline">
                    Ver todos
                  </a>
                  .
                </p>
              </>
            ) : (
              <>
                <CheckCircleIcon className="w-10 h-10 mx-auto text-emerald-500 mb-3" />
                <p className="text-gray-600 text-lg font-medium">
                  No hay productos duplicados. El catálogo está limpio.
                </p>
                <p className="mt-2 max-w-xl mx-auto">
                  Cuando alguien dé de alta un producto que ya existía —mismo nombre o
                  mismo código de barras— aparecerá aquí para fusionarlo sin perder
                  ventas ni existencia.
                </p>
              </>
            )}
          </div>
        </div>
      ) : (
        <Duplicados grupos={grupos} />
      )}
    </div>
  )
}
