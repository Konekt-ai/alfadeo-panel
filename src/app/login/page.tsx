export const dynamic = 'force-dynamic'

// Se pinta encima de todo (fixed inset-0) para tapar el sidebar del layout raíz
// sin tener que reestructurar todas las rutas en grupos.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ destino?: string; error?: string }>
}) {
  const params = await searchParams

  return (
    <div className="fixed inset-0 z-50 bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-[#003366]">ALFA-DEO</h1>
          <p className="text-base text-gray-500 mt-1">Panel interno</p>
        </div>

        <form
          action="/api/login"
          method="POST"
          className="bg-white border border-gray-200 rounded-xl p-6 space-y-4"
        >
          <input type="hidden" name="destino" value={params.destino ?? '/solicitudes'} />

          <div>
            <label htmlFor="password" className="block text-base font-medium text-gray-700 mb-2">
              Contraseña
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoFocus
              required
              autoComplete="current-password"
              className="w-full px-4 py-3 text-base border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#003366]/20 focus:border-[#003366]"
            />
          </div>

          {params.error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              Contraseña incorrecta.
            </p>
          )}

          <button
            type="submit"
            className="w-full px-4 py-3 bg-[#003366] text-white text-base font-medium rounded-lg hover:bg-[#002244] transition-colors"
          >
            Entrar
          </button>
        </form>

        <p className="text-center text-sm text-gray-400 mt-6">
          Acceso sólo para personal de ALFA-DEO.
        </p>
      </div>
    </div>
  )
}
