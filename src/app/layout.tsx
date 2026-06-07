import type { Metadata } from 'next'
import './globals.css'
import Sidebar, { Header } from '@/components/Sidebar'

export const metadata: Metadata = {
  title: 'Panel ALFA-DEO',
  description: 'Panel interno de gestión comercial',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="bg-gray-50 min-h-screen flex flex-col">
        <Header />
        <div className="flex flex-1">
          <Sidebar />
          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </div>
      </body>
    </html>
  )
}
