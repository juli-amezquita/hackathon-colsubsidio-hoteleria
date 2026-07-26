import type { CountEntry } from '@/lib/store'

/**
 * Umbral para marcar una cantidad como inusualmente alta. Como no existe un
 * rango predefinido por producto, usamos un tope de sensatez para pedir
 * validación cuando el número parece demasiado grande.
 */
export const ANOMALY_MAX = 1000

/** Una cantidad es inusual si es cero/negativa o supera el tope de sensatez. */
export function isQuantityAnomaly(quantity: number) {
  return quantity <= 0 || quantity > ANOMALY_MAX
}

/** Normaliza un nombre para comparar duplicados (sin tildes, minúsculas). */
export function normalizeName(name: string) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Busca una entrada existente con el mismo nombre (excluyendo un id opcional). */
export function findDuplicate(name: string, entries: CountEntry[], excludeId?: string) {
  const norm = normalizeName(name)
  if (!norm) return null
  return entries.find((e) => e.id !== excludeId && normalizeName(e.name) === norm) ?? null
}

export function orderedEntries(entries: CountEntry[]) {
  return [...entries].sort((a, b) => a.order - b.order)
}

export function progress(entries: CountEntry[]) {
  const total = entries.length
  const anomalies = entries.filter((e) => e.isAnomaly).length
  const duplicates = entries.filter((e) => e.isDuplicate).length
  const flagged = entries.filter((e) => e.isAnomaly || e.isDuplicate || e.needsReview).length
  return { total, anomalies, duplicates, flagged }
}

export function formatUnit(quantity: number, unit: string) {
  return `${quantity.toLocaleString('es-CO')} ${unit}`
}
