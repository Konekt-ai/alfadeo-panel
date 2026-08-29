import { sql, faltaMigracion } from '@/lib/db'
import Link from 'next/link'
import {
  PlusIcon, MagnifyingGlassIcon, ArrowUpTrayIcon, XMarkIcon,
  QrCodeIcon, FunnelIcon,
} from '@heroicons/react/20/solid'
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { UBICACIONES, SUCURSALES } from '@/lib/constantes'
import { nombreProducto } from '@/lib/utils'

export const dynamic = 'force-dynamic'

// Filtros de inventario (punto 3 de la minuta).
//
// Lo que el cliente llama "inventario actual" e "inventario viejo" aquí se
// llama ESTADO DEL LOTE, y lo calcula PostgreSQL en la misma consulta que
// trae la lista: nada se filtra en JavaScript, porque si no el resumen de
// arriba mentiría y la pantalla tendría que traerse la bodega completa.
//
// Recuerda: una fila de `inventario` ES un lote (producto + plaza + lote +
// ubicación). Un producto tiene varias filas.

// --------------------------------------------------------------- catálogos -

type EstadoLote = 'vigente' | 'por_caducar' | 'vencido' | 'sin_caducidad'

// El corte de 90 días afina el de 30 que había antes: con 30 días ya no da
// tiempo de mover la mercancía ni de negociar la devolución con el
// laboratorio.
const DIAS_POR_CADUCAR = 90

const ESTADOS: { valor: EstadoLote; label: string; ayuda: string; activo: string }[] = [
  { valor: 'vigente',       label: 'Vigente',       ayuda: `caduca en más de ${DIAS_POR_CADUCAR} días`, activo: 'bg-emerald-600 text-white border-emerald-600' },
  { valor: 'por_caducar',   label: 'Por caducar',   ayuda: `caduca dentro de ${DIAS_POR_CADUCAR} días`, activo: 'bg-amber-500 text-white border-amber-500' },
  { valor: 'vencido',       label: 'Vencido',       ayuda: 'ya pasó la caducidad',                      activo: 'bg-red-500 text-white border-red-500' },
  { valor: 'sin_caducidad', label: 'Sin caducidad', ayuda: 'el lote no la tiene capturada',             activo: 'bg-gray-700 text-white border-gray-700' },
]

const EXISTENCIAS: { valor: string; label: string; ayuda: string }[] = [
  { valor: 'con',         label: 'Con existencia', ayuda: 'todavía queda producto en el lote' },
  { valor: 'agotado',     label: 'Agotado',        ayuda: 'el lote quedó en cero' },
  { valor: 'bajo_minimo', label: 'Bajo mínimo',    ayuda: 'la plaza ya está en el mínimo o por debajo' },
]

const CODIGOS: { valor: string; label: string; ayuda: string }[] = [
  { valor: 'con', label: 'Con código', ayuda: 'se puede escanear en el mostrador' },
  { valor: 'sin', label: 'Sin código', ayuda: 'la pistola no lo encuentra' },
]

// ------------------------------------------------------------------ tipos --

interface Filtros {
  q?: string
  sucursal?: string
  ubicacion?: string
  estado?: string
  existencia?: string
  codigo?: string
  categoria?: string
  laboratorio?: string
}

interface FilaInventario {
  id: string
  existencia: number | null
  ubicacion: string | null
  lote: string | null
  caducidad: string | null
  estado_lote: EstadoLote
  existencia_plaza: number | null
  sucursal_clave: string | null
  producto_id: string | null
  nombre: string | null
  nombre_comercial: string | null
  nombre_generico: string | null
  concentracion: string | null
  forma_farmaceutica: string | null
  presentacion: string | null
  laboratorio: string | null
  categoria: string | null
  codigo_barras: string | null
  stock_minimo: number | null
}

interface Resumen {
  productos: number
  piezas: number
  vencidos: number
  por_caducar: number
  sin_codigo: number
}

// ---------------------------------------------------------------- consulta -

// Caducidad efectiva: la que capturaron en el lote y, si ahí viene vacía, la
// del producto. Es la misma regla que ya usaba la pantalla.
const CAD = 'coalesce(i.caducidad, p.caducidad)'

// Un código en blanco ("   ") es tan inservible como uno nulo: la pistola
// tampoco lo encuentra. Se normaliza a null de una vez.
const COD = "nullif(btrim(p.codigo_barras), '')"

/**
 * Arma el WHERE con parámetros $1, $2... Lo que escribió el usuario nunca se
 * concatena dentro del SQL.
 *
 * `conEstado` separa los dos usos: la lista aplica TODOS los filtros; el
 * resumen de arriba aplica sólo los de contexto (plaza, ubicación, categoría,
 * laboratorio y búsqueda), para que las tarjetas no se pongan en cero justo
 * cuando le picas a una.
 */
function construirFiltros(f: Filtros, conEstado: boolean) {
  const cond: string[] = []
  const args: unknown[] = []
  const ph = (v: unknown) => { args.push(v); return `$${args.length}` }

  // Va primero y siempre, porque las DOS consultas lo usan aunque no haya
  // ningún filtro puesto. Un parámetro que se manda pero no se menciona en el
  // SQL truena con "could not determine data type of parameter". El `::int`
  // tampoco es opcional: sin él, `date + $1` es ambiguo (¿entero o intervalo?).
  const dias = `${ph(DIAS_POR_CADUCAR)}::int`

  if (f.q) {
    // Se busca por nombre, empezando por el comercial: es como lo busca el
    // equipo en la vida real, no por código de barras.
    const t = ph(`%${f.q}%`)
    cond.push(
      `(coalesce(p.nombre_comercial, '') ilike ${t}
         or coalesce(p.nombre_generico, '') ilike ${t}
         or coalesce(p.nombre, '') ilike ${t}
         or coalesce(p.laboratorio, '') ilike ${t}
         or coalesce(i.lote, p.lote, '') ilike ${t})`
    )
  }
  if (f.sucursal)    cond.push(`s.clave = ${ph(f.sucursal)}`)
  if (f.ubicacion)   cond.push(`i.ubicacion = ${ph(f.ubicacion)}`)
  if (f.categoria)   cond.push(`p.categoria = ${ph(f.categoria)}`)
  if (f.laboratorio) cond.push(`p.laboratorio = ${ph(f.laboratorio)}`)

  if (conEstado) {
    if (f.estado === 'vencido')       cond.push(`${CAD} < current_date`)
    if (f.estado === 'por_caducar')   cond.push(`${CAD} >= current_date and ${CAD} <= current_date + ${dias}`)
    if (f.estado === 'vigente')       cond.push(`${CAD} > current_date + ${dias}`)
    if (f.estado === 'sin_caducidad') cond.push(`${CAD} is null`)

    if (f.existencia === 'con')     cond.push('coalesce(i.existencia, 0) > 0')
    if (f.existencia === 'agotado') cond.push('coalesce(i.existencia, 0) = 0')
    // El mínimo es del PRODUCTO, no del lote: se compara contra lo que hay en
    // toda la plaza. Si no, tres lotes de 5 con mínimo 10 saldrían los tres
    // como bajo mínimo cuando en realidad hay 15 piezas.
    if (f.existencia === 'bajo_minimo')
      cond.push('coalesce(p.stock_minimo, 0) > 0 and tp.total <= p.stock_minimo')

    if (f.codigo === 'con') cond.push(`${COD} is not null`)
    if (f.codigo === 'sin') cond.push(`${COD} is null`)
  }

  return { where: cond.length ? `where ${cond.join('\n            and ')}` : '', args, dias }
}

// ----------------------------------------------------------------- página --

export default async function InventarioPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string; ubicacion?: string; sucursal?: string; estado?: string
    existencia?: string; codigo?: string; categoria?: string; laboratorio?: string
    vence?: string
  }>
}) {
  const params = await searchParams

  // Next entrega un ARREGLO cuando el mismo parámetro viene repetido en la
  // URL (?q=a&q=b). Sin contemplarlo, `.trim()` truena y la pantalla entera
  // se cae con un 500 en vez de ignorar la basura, que es justo lo que se
  // quería. Se toma el primero.
  const limpio = (v: string | string[] | undefined) => {
    const s = Array.isArray(v) ? v[0] : v
    return s && s.trim() ? s.trim() : undefined
  }
  const deLista = (v: string | undefined, validos: string[]) =>
    v && validos.includes(v) ? v : undefined

  // `vence` era el filtro viejo (30 días / vencidos). Se sigue entendiendo
  // para no romper los enlaces guardados, pero ya se traduce al estado nuevo.
  const estadoViejo =
    params.vence === 'vencido' ? 'vencido' : params.vence === '30' ? 'por_caducar' : undefined

  const f: Filtros = {
    q:           limpio(params.q),
    sucursal:    deLista(limpio(params.sucursal), SUCURSALES.map(s => s.clave)),
    ubicacion:   deLista(limpio(params.ubicacion), UBICACIONES),
    estado:      deLista(limpio(params.estado), ESTADOS.map(e => e.valor)) ?? estadoViejo,
    existencia:  deLista(limpio(params.existencia), EXISTENCIAS.map(e => e.valor)),
    codigo:      deLista(limpio(params.codigo), CODIGOS.map(c => c.valor)),
    categoria:   limpio(params.categoria),
    laboratorio: limpio(params.laboratorio),
  }

  const lista = construirFiltros(f, true)
  const contexto = construirFiltros(f, false)

  const [listaRes, resumenRes, catalogoRes] = await Promise.all([
    // UNA consulta con los filtros en el WHERE, uniendo inventario + productos
    // + sucursales. El left join se conserva a propósito: un lote cuyo
    // producto se borró tiene que seguir viéndose, si no desaparecería de la
    // pantalla mercancía que sí está en la bodega.
    sql<FilaInventario>(
      `select i.id,
              i.existencia,
              i.ubicacion,
              coalesce(i.lote, p.lote)  as lote,
              ${CAD}                    as caducidad,
              case
                when ${CAD} is null         then 'sin_caducidad'
                when ${CAD} <  current_date then 'vencido'
                when ${CAD} <= current_date + ${lista.dias} then 'por_caducar'
                else 'vigente'
              end                       as estado_lote,
              tp.total                  as existencia_plaza,
              s.clave                   as sucursal_clave,
              p.id                      as producto_id,
              p.nombre,
              p.nombre_comercial,
              p.nombre_generico,
              p.concentracion,
              p.forma_farmaceutica,
              p.presentacion,
              p.laboratorio,
              p.categoria,
              p.stock_minimo,
              ${COD}                    as codigo_barras
         from inventario i
         left join sucursales s on s.id = i.sucursal_id
         left join productos  p on p.id = i.producto_id
         -- Lo que hay del mismo producto en la misma plaza, sumando sus lotes.
         -- Sirve para el filtro "bajo mínimo" y para la etiqueta de la fila.
         left join lateral (
           select coalesce(sum(coalesce(x.existencia, 0)), 0) as total
             from inventario x
            where x.producto_id = i.producto_id
              and x.sucursal_id is not distinct from i.sucursal_id
         ) tp on true
         ${lista.where}
        order by coalesce(nullif(btrim(p.nombre_comercial), ''), p.nombre_generico, p.nombre) asc nulls last,
                 ${CAD} asc nulls last`,
      lista.args
    ),

    // El resumen se cuenta en la base, no sumando un arreglo ya traído.
    sql<Resumen>(
      `select count(distinct i.producto_id) as productos,
              coalesce(sum(coalesce(i.existencia, 0)), 0) as piezas,
              count(*) filter (where ${CAD} < current_date) as vencidos,
              count(*) filter (
                where ${CAD} >= current_date
                  and ${CAD} <= current_date + ${contexto.dias}
              ) as por_caducar,
              count(distinct i.producto_id) filter (where ${COD} is null) as sin_codigo
         from inventario i
         left join sucursales s on s.id = i.sucursal_id
         left join productos  p on p.id = i.producto_id
         ${contexto.where}`,
      contexto.args
    ),

    // Los dos selects se llenan con lo que de verdad hay capturado.
    sql<{ categorias: string[] | null; laboratorios: string[] | null }>(
      `select
         (select array_agg(v order by v)
            from (select distinct categoria as v
                    from productos
                   where categoria is not null and btrim(categoria) <> '') c) as categorias,
         (select array_agg(v order by v)
            from (select distinct laboratorio as v
                    from productos
                   where laboratorio is not null and btrim(laboratorio) <> '') l) as laboratorios`
    ),
  ])

  const rows = listaRes.data
  const error = listaRes.error ?? resumenRes.error ?? catalogoRes.error
  const resumen: Resumen = resumenRes.data[0] ?? {
    productos: 0, piezas: 0, vencidos: 0, por_caducar: 0, sin_codigo: 0,
  }
  const categorias = catalogoRes.data[0]?.categorias ?? []
  const laboratorios = catalogoRes.data[0]?.laboratorios ?? []

  const piezasEnPantalla = rows.reduce((s, r) => s + Number(r.existencia ?? 0), 0)

  // ---------------------------------------------------------- agrupar -----
  // La consulta devuelve un renglón por LOTE, que es como está guardado y es
  // lo correcto: el mismo lote en dos racks son dos renglones porque
  // físicamente está en dos lugares.
  //
  // Pero pintarlo así repetía el nombre del producto y parecían duplicados
  // cuando no lo son. Se agrupa por producto: UNA línea con el total y el
  // desglose de dónde está.
  //
  // Se agrupa aquí y no en SQL para que los filtros sigan aplicando sobre el
  // lote: si filtras "vencidos", ves el producto con sus lotes vencidos, no
  // el producto entero con todo su inventario.
  interface Grupo {
    producto_id: string
    cabeza: FilaInventario
    lotes: FilaInventario[]
    total: number
    peor: EstadoLote
  }

  // El peor estado manda para el color del renglón: si un producto tiene un
  // lote vencido hay que verlo, aunque los demás estén bien.
  const gravedad = (e: EstadoLote) =>
    e === 'vencido' ? 3 : e === 'por_caducar' ? 2 : 1

  const grupos: Grupo[] = []
  const indicePorProducto = new Map<string, number>()

  for (const r of rows) {
    const clave = r.producto_id ?? r.id
    const i = indicePorProducto.get(clave)
    if (i === undefined) {
      indicePorProducto.set(clave, grupos.length)
      grupos.push({
        producto_id: clave,
        cabeza: r,
        lotes: [r],
        total: Number(r.existencia ?? 0),
        peor: r.estado_lote,
      })
    } else {
      const g = grupos[i]
      g.lotes.push(r)
      g.total += Number(r.existencia ?? 0)
      if (gravedad(r.estado_lote) > gravedad(g.peor)) g.peor = r.estado_lote
    }
  }

  // -------------------------------------------------------------- enlaces --

  const buildUrl = (o: Filtros) => {
    const p: Record<string, string | undefined> = { ...f, ...o }
    const qs = Object.entries(p)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
      .join('&')
    return `/inventario${qs ? `?${qs}` : ''}`
  }

  // Alternar: si el filtro ya está puesto, el mismo enlace lo quita.
  const alternar = (llave: keyof Filtros, valor: string) =>
    buildUrl({ [llave]: f[llave] === valor ? undefined : valor })

  const etiqueta = (llave: keyof Filtros): string => {
    const v = f[llave]!
    if (llave === 'sucursal')   return SUCURSALES.find(s => s.clave === v)?.nombre ?? v
    if (llave === 'estado')     return ESTADOS.find(e => e.valor === v)?.label ?? v
    if (llave === 'existencia') return EXISTENCIAS.find(e => e.valor === v)?.label ?? v
    if (llave === 'codigo')     return CODIGOS.find(c => c.valor === v)?.label ?? v
    return v
  }

  const NOMBRES: Record<keyof Filtros, string> = {
    q: 'Búsqueda', sucursal: 'Plaza', ubicacion: 'Ubicación', estado: 'Estado',
    existencia: 'Existencia', codigo: 'Código', categoria: 'Categoría',
    laboratorio: 'Laboratorio',
  }

  const activos = (Object.keys(NOMBRES) as (keyof Filtros)[])
    .filter(k => f[k])
    .map(k => ({ llave: k, titulo: NOMBRES[k], valor: etiqueta(k), quitar: buildUrl({ [k]: undefined }) }))

  // -------------------------------------------------------------- clases --

  const CHIP = 'px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors'
  const CHIP_OFF = 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
  const CHIP_AZUL = 'bg-[#003366] text-white border-[#003366]'
  const CAMPO = 'px-4 py-3 text-base bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366]'
  const TARJETA = 'bg-white border border-gray-200 rounded-xl p-5 block transition-colors hover:border-gray-300'
  const ROTULO = 'text-sm text-gray-500 font-medium w-32 shrink-0'

  // Las cinco tarjetas del resumen. Cada una deja puesto su propio filtro y
  // suelta los otros dos, para que no se estorben entre sí.
  const tarjetas = [
    {
      label: 'Productos', valor: resumen.productos, sub: 'distintos con lote',
      color: 'text-gray-900', activa: false,
      href: buildUrl({ estado: undefined, existencia: undefined, codigo: undefined }),
    },
    {
      label: 'Piezas', valor: resumen.piezas, sub: 'sumando todos los lotes',
      color: 'text-gray-900', activa: f.existencia === 'con',
      href: buildUrl({ existencia: 'con', estado: undefined, codigo: undefined }),
    },
    {
      label: 'Lotes vencidos', valor: resumen.vencidos, sub: 'inventario viejo',
      color: resumen.vencidos > 0 ? 'text-red-600' : 'text-gray-900',
      activa: f.estado === 'vencido',
      href: buildUrl({ estado: 'vencido', existencia: undefined, codigo: undefined }),
    },
    {
      label: 'Por caducar', valor: resumen.por_caducar, sub: `lotes en ${DIAS_POR_CADUCAR} días`,
      color: resumen.por_caducar > 0 ? 'text-amber-600' : 'text-gray-900',
      activa: f.estado === 'por_caducar',
      href: buildUrl({ estado: 'por_caducar', existencia: undefined, codigo: undefined }),
    },
    {
      label: 'Sin código', valor: resumen.sin_codigo, sub: 'no se pueden escanear',
      color: resumen.sin_codigo > 0 ? 'text-amber-600' : 'text-gray-900',
      activa: f.codigo === 'sin',
      href: buildUrl({ codigo: 'sin', estado: undefined, existencia: undefined }),
    },
  ]

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Inventario</h1>
          <p className="text-base text-gray-500 mt-1">
            {rows.length.toLocaleString('es-MX')} lotes en pantalla ·{' '}
            {piezasEnPantalla.toLocaleString('es-MX')} piezas
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Los códigos de barras de Aspel entran por aquí; sin ellos el POS
              no puede escanear (minuta 22). */}
          <Link href="/inventario/importar"
            className="inline-flex items-center gap-2 px-5 py-2.5 border border-gray-300 text-gray-700 text-base font-medium rounded-lg hover:bg-white transition-colors">
            <ArrowUpTrayIcon className="w-5 h-5 text-gray-400" />
            Importar de Aspel
          </Link>
          <Link href="/inventario/nuevo"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#003366] text-white text-base font-medium rounded-lg hover:bg-[#002244] transition-colors">
            <PlusIcon className="w-5 h-5" />
            Agregar producto
          </Link>
        </div>
      </div>

      {/* Resumen. Cada tarjeta es un enlace que aplica su propio filtro. */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
        {tarjetas.map(t => (
          <Link key={t.label} href={t.href}
            className={`${TARJETA} ${t.activa ? 'ring-2 ring-[#003366] border-[#003366]' : ''}`}>
            <div className="text-sm font-medium text-gray-500">{t.label}</div>
            <div className={`text-2xl font-semibold mt-1 ${t.color}`}>
              {t.valor.toLocaleString('es-MX')}
            </div>
            <div className="text-sm text-gray-400 mt-0.5">{t.sub}</div>
          </Link>
        ))}
      </div>

      {/* Los productos sin código son la razón por la que la pistola todavía
          no sirve en el mostrador (minuta 22). Desde aquí se van a registrarlos. */}
      {resumen.sin_codigo > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex flex-wrap items-center justify-between gap-4">
          <p className="text-base text-amber-900">
            <span className="font-semibold">
              {resumen.sin_codigo.toLocaleString('es-MX')} productos
            </span>{' '}
            no tienen código de barras: en el mostrador hay que buscarlos a mano.
          </p>
          <Link href="/verificador"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#003366] text-white text-base font-medium rounded-lg hover:bg-[#002244] transition-colors">
            <QrCodeIcon className="w-5 h-5" />
            Registrar códigos
          </Link>
        </div>
      )}

      {/* Buscador + filtros */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6 space-y-4">
        <form method="GET" className="space-y-4">
          {/* Los filtros de chip se conservan al buscar o al cambiar un select. */}
          {f.sucursal   && <input type="hidden" name="sucursal"   value={f.sucursal} />}
          {f.ubicacion  && <input type="hidden" name="ubicacion"  value={f.ubicacion} />}
          {f.estado     && <input type="hidden" name="estado"     value={f.estado} />}
          {f.existencia && <input type="hidden" name="existencia" value={f.existencia} />}
          {f.codigo     && <input type="hidden" name="codigo"     value={f.codigo} />}

          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              name="q"
              defaultValue={f.q ?? ''}
              placeholder="Buscar por nombre comercial, genérico, laboratorio o lote..."
              className="w-full pl-11 pr-4 py-3 text-base border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366]"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_auto]">
            <select name="categoria" defaultValue={f.categoria ?? ''} className={CAMPO}>
              <option value="">Todas las categorías</option>
              {categorias.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select name="laboratorio" defaultValue={f.laboratorio ?? ''} className={CAMPO}>
              <option value="">Todos los laboratorios</option>
              {laboratorios.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
            <button type="submit"
              className="inline-flex items-center justify-center gap-2 px-5 py-3 border border-gray-300 text-gray-700 text-base font-medium rounded-lg hover:bg-gray-50 transition-colors">
              <FunnelIcon className="w-5 h-5 text-gray-400" />
              Aplicar
            </button>
          </div>
        </form>

        <div className="flex gap-2 flex-wrap items-center">
          <span className={ROTULO}>Plaza</span>
          {SUCURSALES.map(s => (
            <a key={s.clave} href={alternar('sucursal', s.clave)}
              className={`${CHIP} ${f.sucursal === s.clave ? CHIP_AZUL : CHIP_OFF}`}>
              {s.nombre}
            </a>
          ))}
        </div>

        {/* "Actual" contra "viejo": esto es lo que pidió el cliente. */}
        <div className="flex gap-2 flex-wrap items-center">
          <span className={ROTULO}>Estado del lote</span>
          {ESTADOS.map(e => (
            <a key={e.valor} href={alternar('estado', e.valor)} title={e.ayuda}
              className={`${CHIP} ${f.estado === e.valor ? e.activo : CHIP_OFF}`}>
              {e.label}
            </a>
          ))}
        </div>

        <div className="flex gap-2 flex-wrap items-center">
          <span className={ROTULO}>Existencia</span>
          {EXISTENCIAS.map(e => (
            <a key={e.valor} href={alternar('existencia', e.valor)} title={e.ayuda}
              className={`${CHIP} ${f.existencia === e.valor ? CHIP_AZUL : CHIP_OFF}`}>
              {e.label}
            </a>
          ))}
        </div>

        <div className="flex gap-2 flex-wrap items-center">
          <span className={ROTULO}>Código de barras</span>
          {CODIGOS.map(c => (
            <a key={c.valor} href={alternar('codigo', c.valor)} title={c.ayuda}
              className={`${CHIP} ${f.codigo === c.valor ? CHIP_AZUL : CHIP_OFF}`}>
              {c.label}
            </a>
          ))}
        </div>

        <div className="flex gap-2 flex-wrap items-center">
          <span className={ROTULO}>Ubicación</span>
          {UBICACIONES.map(u => (
            <a key={u} href={alternar('ubicacion', u)}
              className={`${CHIP} ${f.ubicacion === u ? CHIP_AZUL : CHIP_OFF}`}>
              {u}
            </a>
          ))}
        </div>

        {/* Lo que está puesto ahora mismo, cada uno con su tache. */}
        {activos.length > 0 && (
          <div className="flex gap-2 flex-wrap items-center pt-4 border-t border-gray-100">
            <span className={ROTULO}>Filtros activos</span>
            {activos.map(a => (
              <a key={a.llave} href={a.quitar} title={`Quitar el filtro de ${a.titulo.toLowerCase()}`}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-medium border bg-[#003366]/5 text-[#003366] border-[#003366]/20 hover:bg-[#003366]/10 transition-colors">
                <span className="text-gray-500">{a.titulo}:</span>
                {a.valor}
                <XMarkIcon className="w-4 h-4" />
              </a>
            ))}
            <a href="/inventario"
              className="text-sm font-medium text-gray-500 hover:text-gray-800 underline ml-1">
              Limpiar filtros
            </a>
          </div>
        )}
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

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-base min-w-[1100px]">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Producto</th>
              <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Miligramos</th>
              <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Presentación</th>
              <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Laboratorio</th>
              <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Código</th>
              <th className="text-left px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Dónde está</th>
              <th className="text-right px-5 py-4 text-sm font-semibold text-gray-500 uppercase tracking-wide">Piezas</th>
              <th className="px-5 py-4" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {grupos.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center py-20 text-gray-400 text-base">
                  {activos.length > 0
                    ? 'Ningún producto coincide con estos filtros.'
                    : 'Sin resultados.'}
                </td>
              </tr>
            )}
            {grupos.map(g => {
              const r = g.cabeza
              const vencido = g.peor === 'vencido'
              const porCaducar = g.peor === 'por_caducar'
              const minimo = Number(r.stock_minimo ?? 0)
              const bajoMinimo = minimo > 0 && g.total <= minimo
              // Rojo el vencido, ámbar el que está por caducar: de un vistazo
              // se ve cuál es el inventario viejo.
              const fondo = vencido
                ? 'bg-red-50/70 hover:bg-red-50'
                : porCaducar
                  ? 'bg-amber-50/60 hover:bg-amber-50'
                  : 'hover:bg-gray-50/60'
              // El renglón de arriba es `nombreProducto`, que cae al genérico
              // cuando no hay comercial. Comparando contra el comercial, todo
              // producto que sólo tiene genérico -- aquí, la mayoría -- salía
              // con el mismo nombre repetido en los dos renglones.
              const titulo = nombreProducto(r)
              const detalle = [
                r.nombre_generico && r.nombre_generico !== titulo ? r.nombre_generico : null,
                r.forma_farmaceutica,
                r.categoria,
              ].filter(Boolean).join(' · ')

              return (
                <tr key={g.producto_id} className={`${fondo} transition-colors group align-top`}>
                  {/* Comercial arriba, genérico abajo: así lo busca el equipo. */}
                  <td className="px-5 py-4">
                    <div className="font-semibold text-gray-900">{titulo}</div>
                    {detalle && <div className="text-sm text-gray-500 mt-0.5">{detalle}</div>}
                  </td>
                  <td className="px-5 py-4 text-gray-700 whitespace-nowrap">{r.concentracion ?? '—'}</td>
                  <td className="px-5 py-4 text-gray-700">{r.presentacion ?? '—'}</td>
                  <td className="px-5 py-4 text-gray-500">{r.laboratorio ?? '—'}</td>
                  <td className="px-5 py-4">
                    {r.codigo_barras ? (
                      <span className="font-mono text-sm text-gray-500">{r.codigo_barras}</span>
                    ) : (
                      // Sin código no hay escaneo. El enlace lleva al
                      // verificador, que es donde se le pega uno.
                      <Link href="/verificador"
                        title="Este producto no se puede escanear. Ábrelo en el verificador para registrarle su código."
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-800 bg-amber-100 border border-amber-200 px-2.5 py-1 rounded-md whitespace-nowrap hover:bg-amber-200 transition-colors">
                        <QrCodeIcon className="w-4 h-4" />
                        Registrar
                      </Link>
                    )}
                  </td>
                  {/* Un renglón por lugar donde está el producto. Que el mismo
                      lote aparezca en dos racks es normal, no un duplicado:
                      físicamente está en dos lugares. */}
                  <td className="px-5 py-4">
                    <div className="space-y-1.5">
                      {g.lotes.map(l => {
                        const lv = l.estado_lote === 'vencido'
                        const lp = l.estado_lote === 'por_caducar'
                        return (
                          <div key={l.id} className="flex items-center gap-2 flex-wrap text-sm">
                            <span className={`font-semibold px-2 py-0.5 rounded whitespace-nowrap ${
                              l.sucursal_clave === 'MTY'
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-blue-50 text-blue-700'
                            }`}>
                              {l.sucursal_clave ?? '—'}
                            </span>
                            <span className="font-medium text-gray-700 bg-gray-100 px-2 py-0.5 rounded whitespace-nowrap">
                              {l.ubicacion ?? 'sin ubicación'}
                            </span>
                            <span className="font-mono text-gray-500 whitespace-nowrap">
                              {l.lote ?? 'sin lote'}
                            </span>
                            <span className={`inline-flex items-center gap-1 whitespace-nowrap ${
                              lv ? 'text-red-600 font-medium'
                                 : lp ? 'text-amber-600 font-medium' : 'text-gray-500'
                            }`}>
                              {(lv || lp) && <ExclamationTriangleIcon className="w-3.5 h-3.5" />}
                              {l.caducidad
                                ? new Date(l.caducidad + 'T12:00:00').toLocaleDateString('es-MX', { month: 'short', year: 'numeric' })
                                : 'sin caducidad'}
                            </span>
                            <span className="text-gray-900 font-semibold whitespace-nowrap">
                              {Number(l.existencia ?? 0).toLocaleString('es-MX')} pz
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </td>

                  {/* El total del producto, que es lo que la gente quiere saber. */}
                  <td className="px-5 py-4 text-right">
                    <span className={`text-xl font-semibold ${
                      g.total === 0 ? 'text-red-500' : g.total < 10 ? 'text-amber-600' : 'text-gray-900'
                    }`}>
                      {g.total.toLocaleString('es-MX')}
                    </span>
                    {g.lotes.length > 1 && (
                      <div className="text-xs text-gray-400 mt-0.5 whitespace-nowrap">
                        en {g.lotes.length} lugares
                      </div>
                    )}
                    {bajoMinimo && (
                      <div className="text-xs font-medium text-amber-700 mt-0.5 whitespace-nowrap">
                        Bajo mínimo ({minimo})
                      </div>
                    )}
                  </td>

                  <td className="px-5 py-4">
                    <Link href={`/inventario/${r.producto_id ?? r.id}`}
                      className="text-sm font-medium text-[#003366] md:opacity-0 md:group-hover:opacity-100 transition-opacity hover:underline whitespace-nowrap">
                      Editar
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}
