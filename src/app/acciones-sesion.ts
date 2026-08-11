'use server'

// Quién opera y en qué plaza. Se guarda en cookie porque no hay login
// (ver PENDIENTES.md) y aun así todo movimiento tiene que ir firmado
// (minuta 8) y saber a qué inventario pertenece (minuta 28).

import { revalidatePath } from 'next/cache'
import { fijarUsuario, fijarSucursal } from '@/lib/usuario'

export async function cambiarUsuario(nombre: string) {
  fijarUsuario(nombre)
  revalidatePath('/', 'layout')
}

export async function cambiarSucursal(sucursalId: string) {
  fijarSucursal(sucursalId)
  revalidatePath('/', 'layout')
}
