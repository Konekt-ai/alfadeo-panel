import { redirect } from 'next/navigation'

// La entrada del panel es el tablero de pendientes, no la lista de
// solicitudes: lo primero que quieren ver al abrir es qué hay que
// perseguir hoy (minuta 31, 33).
export default function Home() {
  redirect('/inicio')
}
