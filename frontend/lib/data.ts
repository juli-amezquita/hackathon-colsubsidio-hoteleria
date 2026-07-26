import type { Rol } from '@cci/contracts'

/**
 * Tipos y utilidades del cliente. **Ya no hay datos aquí.**
 *
 * Este archivo tenía doce bodegas inventadas y dos usuarios con contraseña
 * `1234` en el código. Servían para construir las pantallas sin backend, y el
 * backend ya existe: las bodegas salen de la sesión —solo las que el usuario
 * tiene asignadas— y las credenciales las verifica el servidor contra
 * argon2id.
 *
 * Conservar la lista falsa al lado de la real sería la forma más fácil de
 * demostrar el sistema sobre datos que no son del cliente sin que nadie lo
 * note.
 */

/**
 * Las unidades del catálogo del cliente. **Son estas cuatro.**
 *
 * No es una lista de conveniencia: `unidad_medida` tiene exactamente estos
 * registros y cada artículo declara cuál espera. Contar en otra unidad dispara
 * alerta en el servidor (FR-2.1), así que ofrecer "cajas" o "bultos" en la
 * interfaz sería ofrecer un camino que siempre acaba en alerta.
 */
export type Unit = 'unidad' | 'kilogramo' | 'litro' | 'porcion'

/** Cómo se llama cada unidad en el catálogo del servidor. */
export const UNIDAD_DEL_SERVIDOR: Record<Unit, string> = {
  unidad: 'Unidad',
  kilogramo: 'Kilogram',
  litro: 'Liter',
  porcion: 'Portion',
}

/** Y al revés, para pintar lo que el servidor devuelve. */
export function unidadDesdeServidor(nombre: string): Unit {
  const entrada = Object.entries(UNIDAD_DEL_SERVIDOR).find(([, v]) => v === nombre)
  return (entrada?.[0] as Unit | undefined) ?? 'unidad'
}

/**
 * Cómo se describe una bodega en una línea.
 *
 * Existía como `${w.city} · ${w.id}` en seis pantallas y pintaba **"undefined"**
 * en todas, porque el cliente no entrega ciudad: sus bodegas se llaman
 * `ZOOLOGICO` y `STOCK ALMACEN AYB`, y no hay más. Se muestra lo que sí hay.
 */
export function describir(w: Warehouse): string {
  return [w.city, w.zone].filter(Boolean).join(' · ') || w.name
}

export interface Warehouse {
  id: string
  name: string
  /**
   * Ciudad y zona: **el cliente no las tiene.**
   *
   * Las bodegas reales se llaman `ZOOLOGICO`, `STOCK ALMACEN AYB`,
   * `STOCK KIOSCO TAQUILLA AYB`. No hay ciudad ni región en el archivo que
   * entregaron, así que quedan opcionales y la interfaz deja el hueco vacío.
   * Rellenarlo con "Bogotá" sería inventar un dato del cliente.
   */
  city?: string
  zone?: string
}

/**
 * Los roles, en las dos lenguas.
 *
 * `afiliado` es como el equipo llamó al Operador —quien recorre el estante
 * contando— y se conserva en la interfaz porque es la palabra con la que se
 * construyeron las pantallas. Hacia el servidor viaja `operador`, que es el
 * rol que existe de verdad.
 */
export type Role = 'afiliado' | 'auditor'

export const ROL_DEL_SERVIDOR: Record<Role, Rol> = {
  afiliado: 'operador',
  auditor: 'auditor',
}

export function rolDesdeServidor(rol: Rol): Role {
  return rol === 'operador' ? 'afiliado' : 'auditor'
}
