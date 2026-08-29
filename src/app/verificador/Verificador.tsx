'use client'

// El verificador del mostrador.
//
// Está pensado para estar abierto todo el día en una pantalla de 1024x768,
// leerse de pie y a un metro, y funcionar SOLO con el lector y el teclado:
// quien lo usa trae una caja en cada mano.
//
// Cuatro modos en la misma pantalla:
//   · Consulta — el código ya está registrado: muestra el producto en grande.
//     Éste es el verificador de precios: nombre, presentación, precio, IVA,
//     existencia por plaza y lotes con su caducidad.
//   · Lista — lo que se tecleó no es un código sino un nombre. Sirve para
//     consultar precio de una caja que no trae código impreso.
//   · Registro — el código es nuevo: se busca el medicamento por nombre y se
//     le pega. Esto es lo que llena `productos.codigo_barras` y hace que la
//     pistola del punto de venta empiece a servir (minuta 22).
//   · Guardado — confirmación de lo anterior.

import { useState, useEffect, useRef, useCallback, useTransition } from 'react'
import {
  MagnifyingGlassIcon, CheckCircleIcon, XMarkIcon, ArrowPathIcon,
  InformationCircleIcon,
} from '@heroicons/react/20/solid'
import { QrCodeIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { pesos, formatDia, nombreProducto } from '@/lib/utils'
import type { ProductoPOS } from '@/lib/types'
import {
  consultarCodigo, buscarPorNombre, registrarCodigo, siguienteSinCodigo,
  consultarProducto,
  type ProductoEncontrado,
} from './acciones'

type Modo =
  | { t: 'espera' }
  | { t: 'consulta'; producto: ProductoEncontrado }
  | { t: 'lista'; texto: string; productos: ProductoPOS[] }
  | { t: 'registro'; codigo: string }
  | { t: 'guardado'; producto: ProductoEncontrado }

export default function Verificador({
  avanceInicial,
  usuario,
}: {
  avanceInicial: { total: number; con: number }
  usuario: string | null
}) {
  const [modo, setModo] = useState<Modo>({ t: 'espera' })
  const [entrada, setEntrada] = useState('')
  const [avance, setAvance] = useState(avanceInicial)
  const [error, setError] = useState<string | null>(null)
  const [confirmar, setConfirmar] = useState<string | null>(null)
  // A QUÉ producto se refiere la confirmación. No se puede volver a sacar de
  // `resultados[sel]` al apretar "Sí, reemplazar": `sel` se mueve solo con
  // pasar el mouse por la lista camino al botón, y el código terminaría
  // pegado a otro medicamento sin que nadie se entere.
  const [porConfirmar, setPorConfirmar] = useState<string | null>(null)
  // Lo que hizo `asignar_codigo_barras` de más: fusionar duplicados vacíos o
  // quitarle el código a un producto con historial. Hay que decirlo.
  const [aviso, setAviso] = useState<string | null>(null)

  // Búsqueda por nombre (modo registro)
  const [qNombre, setQNombre] = useState('')
  const [resultados, setResultados] = useState<ProductoPOS[]>([])
  const [sel, setSel] = useState(0)
  const [buscando, setBuscando] = useState(false)
  const [pendiente, startTransition] = useTransition()

  const refEscaneo = useRef<HTMLInputElement>(null)
  const refNombre = useRef<HTMLInputElement>(null)
  // Productos ya mostrados por "siguiente sin código", para no repetirlos.
  const vistos = useRef<string[]>([])

  const enfocarEscaneo = useCallback(() => {
    setTimeout(() => refEscaneo.current?.focus(), 30)
  }, [])

  useEffect(() => { enfocarEscaneo() }, [enfocarEscaneo])

  const limpiar = useCallback(() => {
    setModo({ t: 'espera' })
    setEntrada(''); setQNombre(''); setResultados([]); setSel(0)
    setError(null); setConfirmar(null); setPorConfirmar(null); setAviso(null)
    enfocarEscaneo()
  }, [enfocarEscaneo])

  // --- Escaneo ---------------------------------------------------------

  // Abre la ficha grande de un producto ya elegido. Es el verificador de
  // precios propiamente dicho.
  const abrirFicha = useCallback(async (productoId: string) => {
    const r = await consultarProducto(productoId)
    if (r.error) { setError(r.error); return }
    if (!r.producto) { setError('Ese producto ya no existe.'); return }
    setModo({ t: 'consulta', producto: r.producto })
    enfocarEscaneo()
  }, [enfocarEscaneo])

  const verFicha = (productoId: string) => {
    setError(null)
    startTransition(async () => { await abrirFicha(productoId) })
  }

  const escanear = (codigo: string) => {
    const c = codigo.trim()
    if (!c) return
    setError(null); setConfirmar(null); setAviso(null)

    startTransition(async () => {
      const r = await consultarCodigo(c)
      setEntrada('')

      if (r.estado === 'invalido') {
        // Un fallo real de la base se muestra tal cual.
        if (r.error) { setError(r.error); enfocarEscaneo(); return }

        // No es un código, pero puede ser un nombre tecleado: la caja sin
        // código impreso también se tiene que poder consultar.
        if (!/^\d+$/.test(c) && c.length >= 2) {
          const b = await buscarPorNombre(c)
          if (b.error) { setError(b.error); enfocarEscaneo(); return }
          if (b.productos.length === 0) {
            setError(`Ningún producto coincide con "${c}". Prueba con el nombre comercial.`)
            enfocarEscaneo()
            return
          }
          if (b.productos.length === 1) { await abrirFicha(b.productos[0].producto_id); return }
          setModo({ t: 'lista', texto: c, productos: b.productos })
          setSel(0)
          enfocarEscaneo()
          return
        }

        setError(
          `"${c}" no parece un código de barras. El lector debe mandar entre 8 y 14 dígitos; ` +
          'si manda letras o símbolos, tiene un prefijo configurado que hay que quitarle.'
        )
        enfocarEscaneo()
        return
      }
      if (r.estado === 'encontrado' && r.producto) {
        setModo({ t: 'consulta', producto: r.producto })
        enfocarEscaneo()
        return
      }
      // No registrado: se pasa a registro y el foco salta al buscador.
      setModo({ t: 'registro', codigo: r.codigo })
      setTimeout(() => refNombre.current?.focus(), 40)
    })
  }

  // --- Buscador por nombre, con rebote ---------------------------------

  useEffect(() => {
    if (modo.t !== 'registro') return
    const t = qNombre.trim()
    // Sin apagar el indicador, borrar hasta dejar una letra deja "Buscando..."
    // encendido para siempre: parece colgado y no lo está.
    if (t.length < 2) { setResultados([]); setBuscando(false); return }

    let cancelado = false
    setBuscando(true)
    const temporizador = setTimeout(async () => {
      const r = await buscarPorNombre(t)
      if (cancelado) return
      setBuscando(false)
      setResultados(r.productos)
      setSel(0)
      if (r.error) setError(r.error)
    }, 250)

    return () => { cancelado = true; clearTimeout(temporizador) }
  }, [qNombre, modo])

  // --- Guardar ---------------------------------------------------------

  const guardar = (productoId: string, forzar = false) => {
    if (modo.t !== 'registro') return
    setError(null)

    startTransition(async () => {
      const r = await registrarCodigo(productoId, modo.codigo, forzar)

      if ('confirmar' in r) { setPorConfirmar(productoId); setConfirmar(r.confirmar); return }
      if (!r.ok) { setError(r.error); return }

      setConfirmar(null); setPorConfirmar(null)
      // `asignar_codigo_barras` pudo fusionar un duplicado vacío o dejar sin
      // código a otro producto: si pasó, se avisa en vez de callarlo.
      setAviso(r.aviso)
      setModo({ t: 'guardado', producto: r.producto })
      setAvance(a => ({ ...a, con: a.con + 1 }))
      setQNombre(''); setResultados([])
      // Listo para la siguiente caja, sin recargar ni perder el ritmo.
      enfocarEscaneo()
    })
  }

  const traerSiguiente = () => {
    setError(null)
    startTransition(async () => {
      const r = await siguienteSinCodigo(vistos.current)
      if (!r.producto) {
        setError('Ya no quedan productos sin código de barras.')
        return
      }
      vistos.current = [...vistos.current, r.producto.producto_id].slice(-50)
      setModo({ t: 'consulta', producto: r.producto })
    })
  }

  // Escape limpia desde cualquier lado.
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') limpiar() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [limpiar])

  const pct = avance.total ? Math.round((avance.con / avance.total) * 100) : 0
  const hoy = new Date().toISOString().slice(0, 10)
  const en60 = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10)

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      {/* --- Avance ----------------------------------------------------- */}
      <div className="flex items-center gap-4 mb-5">
        <QrCodeIcon className="w-8 h-8 text-[#003366] shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="text-2xl font-semibold text-gray-900">Verificador</h1>
            <span className="text-base text-gray-600 whitespace-nowrap">
              <strong className="text-gray-900">{avance.con}</strong> de {avance.total} con código
            </span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full mt-2 overflow-hidden">
            <div className="h-full bg-[#003366] transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <button
          type="button"
          onClick={traerSiguiente}
          className="hidden sm:inline-flex items-center gap-2 px-4 py-2.5 border border-gray-300 rounded-lg text-base font-medium text-gray-700 hover:bg-gray-50 transition-colors shrink-0"
        >
          <ArrowPathIcon className="w-5 h-5 text-gray-400" />
          Siguiente sin código
        </button>
      </div>

      {/* --- Campo de escaneo ------------------------------------------- */}
      <div className="relative mb-4">
        <MagnifyingGlassIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-6 h-6 text-gray-400" />
        <input
          ref={refEscaneo}
          value={entrada}
          onChange={e => setEntrada(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); escanear(entrada) } }}
          onBlur={() => { if (modo.t !== 'registro' && modo.t !== 'lista') enfocarEscaneo() }}
          placeholder="Dispara el lector sobre la caja o escribe el nombre..."
          autoComplete="off"
          className="w-full pl-14 pr-4 py-5 text-2xl font-mono border-2 border-[#003366] rounded-xl focus:outline-none focus:ring-4 focus:ring-[#003366]/20"
        />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-4 text-base flex items-start gap-3">
          <ExclamationTriangleIcon className="w-6 h-6 shrink-0 mt-0.5" />
          <div className="flex-1">{error}</div>
          <button onClick={() => setError(null)} className="shrink-0 text-red-400 hover:text-red-600">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Lo que la base hizo de más al asignar el código. */}
      {aviso && (
        <div className="bg-blue-50 border border-blue-200 text-blue-900 rounded-xl p-4 mb-4 text-base flex items-start gap-3">
          <InformationCircleIcon className="w-6 h-6 shrink-0 mt-0.5 text-blue-500" />
          <div className="flex-1">{aviso}</div>
          <button onClick={() => setAviso(null)} className="shrink-0 text-blue-400 hover:text-blue-700">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* --- Espera ------------------------------------------------------ */}
      {modo.t === 'espera' && (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
          <QrCodeIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <p className="text-xl text-gray-500">Escanea una caja para empezar</p>
          <p className="text-base text-gray-400 mt-2">
            Si el código ya está registrado, verás el medicamento con su precio.
            Si no, lo buscas por nombre y queda ligado.
          </p>
          <p className="text-base text-gray-400 mt-1">
            ¿La caja no trae código? Escribe el nombre y dale Enter.
          </p>
        </div>
      )}

      {/* --- Elegir entre varios (se tecleó un nombre) -------------------- */}
      {modo.t === 'lista' && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <div className="text-lg font-semibold text-gray-900">
              {modo.productos.length} productos coinciden con “{modo.texto}”
            </div>
            <div className="text-base text-gray-500 mt-0.5">
              Elige cuál para ver su precio y su existencia.
            </div>
          </div>
          <div className="divide-y divide-gray-50 max-h-[52vh] overflow-y-auto">
            {modo.productos.map((p, i) => (
              <button
                key={p.producto_id}
                onMouseEnter={() => setSel(i)}
                onClick={() => verFicha(p.producto_id)}
                disabled={pendiente}
                className={`w-full text-left px-6 py-4 transition-colors disabled:opacity-50 ${
                  i === sel ? 'bg-[#003366]/8' : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-lg font-semibold text-gray-900">{nombreProducto(p)}</span>
                  {p.precio_base != null && (
                    <span className="text-lg font-semibold text-[#003366] shrink-0">
                      {pesos(p.precio_base)}
                    </span>
                  )}
                </div>
                <div className="text-base text-gray-600 mt-0.5">
                  {[p.nombre_generico, p.concentracion, p.presentacion, p.laboratorio]
                    .filter(Boolean).join(' · ') || '—'}
                  {!p.codigo_barras && (
                    <span className="text-amber-700 font-medium"> · sin código de barras</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* --- Consulta y confirmación de guardado -------------------------- */}
      {(modo.t === 'consulta' || modo.t === 'guardado') && (
        <FichaProducto
          producto={modo.producto}
          recienGuardado={modo.t === 'guardado'}
          hoy={hoy}
          en60={en60}
        />
      )}

      {/* --- Registro ----------------------------------------------------- */}
      {modo.t === 'registro' && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="bg-amber-50 border-b border-amber-200 px-6 py-4">
            <div className="text-lg font-semibold text-amber-900">Código no registrado</div>
            <div className="font-mono text-2xl text-amber-800 mt-1">{modo.codigo}</div>
            <div className="text-base text-amber-800 mt-2">
              Busca el medicamento por su nombre y elígelo: queda ligado a este código.
            </div>
          </div>

          <div className="p-5">
            <input
              ref={refNombre}
              value={qNombre}
              onChange={e => setQNombre(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, resultados.length - 1)) }
                if (e.key === 'ArrowUp')   { e.preventDefault(); setSel(s => Math.max(s - 1, 0)) }
                if (e.key === 'Enter')     { e.preventDefault(); const p = resultados[sel]; if (p) guardar(p.producto_id) }
              }}
              placeholder="Nombre del medicamento..."
              autoComplete="off"
              className="w-full px-4 py-4 text-xl border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366]"
            />
            <p className="text-sm text-gray-500 mt-2">
              Flechas para moverte, Enter para ligar, Escape para cancelar.
            </p>
          </div>

          {confirmar && (
            <div className="mx-5 mb-5 bg-amber-50 border border-amber-300 rounded-lg p-4">
              <div className="text-base text-amber-900">{confirmar}</div>
              <div className="flex gap-3 mt-3">
                <button
                  onClick={() => { if (porConfirmar) guardar(porConfirmar, true) }}
                  disabled={pendiente || !porConfirmar}
                  className="px-5 py-2.5 bg-amber-600 text-white text-base font-medium rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
                >
                  Sí, reemplazar
                </button>
                <button
                  onClick={() => { setConfirmar(null); setPorConfirmar(null) }}
                  className="px-5 py-2.5 border border-gray-300 text-gray-700 text-base font-medium rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          <div className="border-t border-gray-100 divide-y divide-gray-50 max-h-[46vh] overflow-y-auto">
            {buscando && resultados.length === 0 && (
              <div className="px-6 py-5 text-base text-gray-400">Buscando...</div>
            )}
            {!buscando && qNombre.trim().length >= 2 && resultados.length === 0 && (
              <div className="px-6 py-8 text-center text-base text-gray-400">
                Ningún medicamento coincide. Prueba con el nombre comercial.
              </div>
            )}
            {resultados.map((p, i) => (
              <button
                key={p.producto_id}
                onMouseEnter={() => setSel(i)}
                onClick={() => guardar(p.producto_id)}
                disabled={pendiente}
                className={`w-full text-left px-6 py-4 transition-colors ${
                  i === sel ? 'bg-[#003366]/8' : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-baseline justify-between gap-4">
                  {/* El comercial primero: es como lo busca el equipo (minuta 20). */}
                  <span className="text-lg font-semibold text-gray-900">
                    {p.nombre_comercial ?? p.nombre_generico ?? p.nombre}
                  </span>
                  {p.codigo_barras && (
                    <span className="text-sm font-mono text-amber-700 shrink-0">
                      ya tiene {p.codigo_barras}
                    </span>
                  )}
                </div>
                {/* Genérico, mg y presentación: dos productos pueden diferir
                    sólo en la presentación (minuta 18). */}
                <div className="text-base text-gray-600 mt-0.5">
                  {[p.nombre_generico, p.concentracion, p.presentacion, p.laboratorio]
                    .filter(Boolean).join(' · ') || '—'}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {usuario && (
        <p className="text-sm text-gray-400 mt-4 text-center">
          Registrando como {usuario}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
//  Ficha grande: se lee de pie, a un metro de la pantalla.
// ---------------------------------------------------------------------
function FichaProducto({
  producto: p,
  recienGuardado,
  hoy,
  en60,
}: {
  producto: ProductoEncontrado
  recienGuardado: boolean
  hoy: string
  en60: string
}) {
  return (
    <div className={`bg-white border rounded-xl overflow-hidden ${
      recienGuardado ? 'border-emerald-300' : 'border-gray-200'
    }`}>
      {recienGuardado && (
        <div className="bg-emerald-50 border-b border-emerald-200 px-6 py-3 flex items-center gap-2">
          <CheckCircleIcon className="w-6 h-6 text-emerald-600" />
          <span className="text-lg font-semibold text-emerald-900">
            Guardado. Escanea la siguiente caja.
          </span>
        </div>
      )}

      <div className="p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-4xl font-bold text-gray-900 leading-tight">
              {p.nombre_comercial ?? p.nombre_generico ?? p.nombre}
            </h2>
            <p className="text-xl text-gray-600 mt-2">
              {[p.nombre_generico !== p.nombre_comercial ? p.nombre_generico : null,
                p.concentracion, p.forma_farmaceutica, p.presentacion]
                .filter(Boolean).join(' · ')}
            </p>
            {p.laboratorio && (
              <p className="text-lg text-gray-500 mt-1">{p.laboratorio}</p>
            )}
          </div>
          <div className="text-right shrink-0">
            {p.precio_base != null ? (
              <div className="text-4xl font-bold text-[#003366]">{pesos(p.precio_base)}</div>
            ) : (
              <div className="text-xl text-amber-700 font-medium">Sin precio</div>
            )}
            {/* La mayoría de sus productos no causa IVA (minuta 3). */}
            <div className="text-base text-gray-500 mt-1">
              {Number(p.tasa_iva) === 0 ? 'IVA 0%' : `IVA ${Math.round(Number(p.tasa_iva) * 100)}%`}
            </div>
            {p.controlado && (
              <div className="text-base font-semibold text-red-600 mt-1">Controlado</div>
            )}
          </div>
        </div>

        {p.codigo_barras && (
          <div className="font-mono text-lg text-gray-500 mt-4">{p.codigo_barras}</div>
        )}
      </div>

      {/* Existencia por plaza (minuta 28) */}
      <div className="border-t border-gray-100 px-6 py-4 flex flex-wrap items-center gap-6">
        <div>
          <div className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Existencia</div>
          <div className={`text-3xl font-bold ${
            Number(p.existencia_total) === 0 ? 'text-red-600' : 'text-gray-900'
          }`}>
            {Number(p.existencia_total)} pz
          </div>
        </div>
        {p.plazas.map(pl => (
          <div key={pl.sucursal}>
            <div className="text-sm font-semibold text-gray-500 uppercase tracking-wide">{pl.sucursal}</div>
            <div className="text-2xl font-semibold text-gray-700">{Number(pl.existencia)}</div>
          </div>
        ))}
        {p.plazas.length === 0 && (
          <div className="text-lg text-red-600 font-medium">Sin existencia en ninguna plaza</div>
        )}
      </div>

      {/* Lotes: en farmacia la caducidad es lo primero que se revisa */}
      {p.lotes.length > 0 && (
        <div className="border-t border-gray-100 px-6 py-4">
          <div className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Lotes
          </div>
          <div className="flex flex-wrap gap-2">
            {p.lotes.map((l, i) => {
              const vencido = l.caducidad && l.caducidad < hoy
              const proximo = l.caducidad && !vencido && l.caducidad <= en60
              return (
                <span
                  key={i}
                  className={`text-base px-3 py-1.5 rounded-lg font-medium ${
                    vencido ? 'bg-red-100 text-red-800'
                      : proximo ? 'bg-amber-100 text-amber-800'
                      : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {l.lote ?? 's/lote'} · {Number(l.existencia)} pz
                  {l.caducidad && ` · ${formatDia(l.caducidad)}`}
                  {l.sucursal && ` · ${l.sucursal}`}
                  {vencido && ' · VENCIDO'}
                </span>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
