import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Panel ALFA-DEO',
  description: 'Panel interno de gestión comercial',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="bg-gray-50 min-h-screen">
        <div className="flex min-h-screen">
          {/* Sidebar */}
          <aside className="w-56 bg-[#003366] text-white flex flex-col shrink-0">
            <div className="px-5 py-6 border-b border-white/10">
              <div className="text-xs font-semibold tracking-widest text-white/50 uppercase mb-1">Panel interno</div>
              <div className="font-bold text-lg leading-tight">ALFA-DEO</div>
              <div className="text-xs text-white/60">Alianza Farmacéutica</div>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1">
              <a href="/solicitudes"
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-white/10 transition-colors">
                <span>📋</span> Solicitudes
              </a>
              <a href="/clientes"
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-white/10 transition-colors">
                <span>👥</span> Clientes
              </a>
            </nav>
            <div className="px-5 py-4 border-t border-white/10 text-xs text-white/40">
              alfadeo.mx
            </div>
          </aside>

          {/* Main */}
          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </div>
      </body>
    </html>
  )
}
