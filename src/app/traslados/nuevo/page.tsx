import Link from 'next/link'
import { ArrowLeftIcon } from '@heroicons/react/20/solid'
import { supabase } from '@/lib/supabase'
import { resolverSucursal } from '@/lib/usuario'
import { fechaEntregaEstimada, fechaISO, textoEntrega } from '@/lib/entrega'
import TrasladoForm from './TrasladoForm'

export const dynamic = 'force-dynamic'

interface PlazaFila {
  id: string
  clave: string | null
  nombre: string | null
  ciudad: string | null
}

export default async function NuevoTrasladoPage() {
  const [{ data, error }, plazaActiva] = await Promise.all([
    supabase
      .from('sucursales')
      .select('id, clave, nombre, ciudad, es_matriz')
      .eq('activo', true)
      .order('es_matriz', { ascending: false }),
    resolverSucursal(),
  ])

  const filas = (data ?? []) as unknown as PlazaFila[]
  const plazas = filas.map(p => ({
    id: p.id,
    clave: p.clave ?? '—',
    nombre: p.nombre ?? p.clave ?? 'Plaza',
    ciudad: p.ciudad,
  }))

  // Origen = la plaza en la que se está trabajando (minuta 8). Destino =
  // la otra: hoy sólo son dos, y MTY se surte de GDL.
  const origenInicial = plazaActiva?.id ?? plazas[0]?.id ?? ''
  const destinoInicial = plazas.find(p => p.id !== origenInicial)?.id ?? ''

  // La fecha se precarga con la regla de DHL: día siguiente hábil, y si
  // sale viernes llega el martes (minuta 5).
  const fechaEstimada = fechaISO(fechaEntregaEstimada())
  const explicacionEntrega = textoEntrega()

  return (
    <div className="p-8">
      <Link
        href="/traslados"
        className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 mb-6"
      >
        <ArrowLeftIcon className="w-3.5 h-3.5" /> Traslados
      </Link>

      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Nuevo traslado</h1>
        <p className="text-base text-gray-500 mt-1">
          Un solo documento para las dos plazas: sale del origen y entra en el destino
          con el mismo lote, sin recapturar nada.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-6 text-base">
          {error.message}
          {/relation|column|function|schema cache|does not exist|no existe/i.test(error.message) && (
            <p className="mt-2 text-sm">
              Falta correr <code className="font-mono">supabase/reunion-operacion.sql</code> en el SQL Editor de Supabase.
            </p>
          )}
        </div>
      )}

      {plazas.length < 2 ? (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-5 text-base">
          Se necesitan al menos dos plazas activas para trasladar mercancía.
          Revisa la tabla <code className="font-mono">sucursales</code>.
        </div>
      ) : (
        <TrasladoForm
          plazas={plazas}
          origenInicial={origenInicial}
          destinoInicial={destinoInicial}
          fechaEstimada={fechaEstimada}
          explicacionEntrega={explicacionEntrega}
        />
      )}
    </div>
  )
}
