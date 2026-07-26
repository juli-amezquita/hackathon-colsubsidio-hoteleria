'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * El cliente del Dashboard Administrativo.
 *
 * Todo sale del servidor. No hay una sola cifra calculada aquí: la definición
 * de "faltante", de "aclarada" o de "precisión" vive en `metricas.service.ts`,
 * en SQL, y se escribe una vez. Recalcularla en el navegador crearía una
 * segunda versión de la verdad, y el día que las dos divergieran —al cambiar
 * una regla en un solo lado— nadie sabría cuál cifra es la que se le enseñó al
 * cliente.
 *
 * Por eso este archivo es casi todo tipos y un `fetch`.
 */

const BASE = process.env.NEXT_PUBLIC_API_URL ?? ''

async function pedir<T>(ruta: string): Promise<T> {
  const r = await fetch(`${BASE}${ruta}`, {
    credentials: 'include',
    headers: { accept: 'application/json' },
    cache: 'no-store',
  })
  if (!r.ok) {
    const cuerpo = (await r.json().catch(() => null)) as { mensaje?: string } | null
    throw new Error(cuerpo?.mensaje ?? `No se pudo consultar (${r.status}).`)
  }
  return r.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Tipos · el mismo vocabulario que devuelve el servidor
// ---------------------------------------------------------------------------

export interface Kpi {
  contadas: number
  sinDiferencia: number
  conDiferencia: number
  aclaradas: number
  faltantes: number
  sobrantes: number
  fantasmas: number
  sinCobertura: number
  pendientes: number
  valorAjuste: number | null
  valorFaltantes: number | null
  valorSobrantes: number | null
  conCosto: number
  sinCosto: number
}

export interface KpiDeBodega extends Kpi {
  bodegaId: string
  bodega: string
  /** `cierre` = avalado por el Auditor. `proyeccion` = el mes va en curso. */
  fuente: 'cierre' | 'proyeccion'
  cerradoEn: string | null
  precision: number | null
}

export interface Resumen {
  periodo: string
  global: Kpi & { precision: number | null; bodegas: number }
  bodegas: KpiDeBodega[]
}

export interface Periodos {
  periodos: { periodo: string; bodegasCerradas: number; ultimoCierre: string; enCurso: boolean }[]
  bodegas: { id: string; nombre: string }[]
  mesActual: string
}

export interface FilaDetalle {
  codigo: string | null
  nombre: string
  unidad: string
  bodega: string
  cantidadFisica: string | null
  cantidadSistema: string | null
  diferencia: string | null
  clasificacion: string
  motivo: string | null
  codigoRazon: string | null
  origenValor: string | null
  valorAjuste: number | null
  esFantasma: boolean
}

export interface PuntoHistorico {
  periodo: string
  contadas: number | null
  conDiferencia: number | null
  faltantes: number | null
  sobrantes: number | null
  precision: number | null
  valorAjuste: number | null
}

export interface Historia {
  meses: string[]
  series: { bodegaId: string; bodega: string; puntos: PuntoHistorico[] }[]
}

export interface Autopulido {
  periodo: string
  simulado: boolean
  rondasAnalizadas: number
  registros: number
  indice: { aciertoGramatica: number | null; desambiguacion: number | null; correccion: number | null }
  tendencia: { periodo: string; aciertoGramatica: number; desambiguacion: number; correccion: number }[]
  hallazgos: { titulo: string; veces: number; bodega: string | null }[]
  propuestas: { id: string; tipo: string; accion: string; evidencia: string; veces: number; estado: string; aplicable: boolean }[]
}

// ---------------------------------------------------------------------------
// Llamadas
// ---------------------------------------------------------------------------

export const periodos = () => pedir<Periodos>('/metricas/periodos')

export const resumen = (periodo: string) => pedir<Resumen>(`/metricas/resumen?periodo=${periodo}`)

export const historia = (meses: number, bodega?: string) =>
  pedir<Historia>(`/metricas/historia?meses=${meses}${bodega ? `&bodega=${bodega}` : ''}`)

export const autopulido = (periodo: string) => pedir<Autopulido>(`/metricas/autopulido?periodo=${periodo}`)

export const causas = (periodo: string, bodega?: string) =>
  pedir<{ causas: { causa: string; descripcion: string; referencias: number; valorAjuste: number | null }[] }>(
    `/metricas/causas?periodo=${periodo}${bodega ? `&bodega=${bodega}` : ''}`,
  )

export const detalle = (o: { periodo: string; bodega?: string; estado?: string; q?: string; limite?: number; desde?: number }) => {
  const p = new URLSearchParams({ periodo: o.periodo })
  if (o.bodega) p.set('bodega', o.bodega)
  if (o.estado) p.set('estado', o.estado)
  if (o.q?.trim()) p.set('q', o.q.trim())
  p.set('limite', String(o.limite ?? 50))
  p.set('desde', String(o.desde ?? 0))
  return pedir<{ total: number; items: FilaDetalle[] }>(`/metricas/detalle?${p}`)
}

export const articulo = (clave: { codigo?: string; nombre?: string }) => {
  const p = new URLSearchParams()
  if (clave.codigo) p.set('codigo', clave.codigo)
  if (clave.nombre) p.set('nombre', clave.nombre)
  return pedir<{
    clave: string | null
    nombre: string | null
    unidad: string | null
    puntos: { periodo: string; bodega: string; cantidadFisica: string | null; cantidadSistema: string | null; diferencia: string | null; valorAjuste: number | null }[]
  }>(`/metricas/articulo?${p}`)
}

// ---------------------------------------------------------------------------
// Enganche genérico
// ---------------------------------------------------------------------------

/**
 * Carga con estado de error visible.
 *
 * Sin `catch` mudo a propósito: en este producto ya hubo pantallas que se
 * quedaban cargando para siempre porque el error se guardaba en una variable
 * que nadie pintaba. Aquí el error es parte del valor de retorno y el
 * componente no puede ignorarlo sin que se le note.
 */
export function useCarga<T>(cargar: () => Promise<T>, deps: readonly unknown[]) {
  const [datos, setDatos] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fn = useCallback(cargar, deps)

  const recargar = useCallback(() => {
    let vigente = true
    setCargando(true)
    setError(null)
    fn()
      .then((d) => { if (vigente) setDatos(d) })
      .catch((e: unknown) => { if (vigente) setError(e instanceof Error ? e.message : 'No se pudo consultar.') })
      .finally(() => { if (vigente) setCargando(false) })
    return () => { vigente = false }
  }, [fn])

  useEffect(() => recargar(), [recargar])

  return { datos, error, cargando, recargar }
}

// ---------------------------------------------------------------------------
// Formato · Colombia
// ---------------------------------------------------------------------------

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** `2026-07` → `jul 2026`. Se parte la cadena: `new Date('2026-07')` es UTC y en Bogotá cae en junio. */
export function nombreDeMes(periodo: string): string {
  const [anio, mes] = periodo.split('-')
  return `${MESES[Number(mes) - 1] ?? mes} ${anio}`
}

export const numero = (n: number) => n.toLocaleString('es-CO')

/** Pesos sin decimales: el ajuste contable de un inventario no se lee en centavos. */
export function pesos(n: number | null): string {
  if (n === null) return '—'
  return n.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
}

export function porcentaje(v: number | null, decimales = 1): string {
  if (v === null || !Number.isFinite(v)) return '—'
  return `${(v * 100).toFixed(decimales)} %`
}

/** Cantidades: se recortan los ceros de `numeric(14,3)` sin perder los decimales reales. */
export function cantidad(v: string | null): string {
  if (v === null) return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return v
  return n.toLocaleString('es-CO', { maximumFractionDigits: 3 })
}
