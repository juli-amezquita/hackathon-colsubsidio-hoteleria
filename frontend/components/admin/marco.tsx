'use client'

import { AlertTriangle, BarChart3, Loader2, Sparkles, Table2, TrendingUp } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'

import { TopBar } from '@/components/top-bar'
import * as m from '@/lib/metricas'
import { cn } from '@/lib/utils'

/**
 * El marco del tablero: la barra, las cuatro secciones y los filtros.
 *
 * Los filtros —mes y bodega— viven en la URL y no en el estado de React. Es
 * deliberado: la gerencia comparte estas pantallas por chat ("mira lo de
 * julio en el Zoológico"), y un filtro guardado en memoria produce un enlace
 * que abre otra cosa para quien lo recibe. Además sobrevive a recargar, que es
 * lo primero que hace todo el mundo cuando algo se ve raro.
 */

const SECCIONES = [
  { href: '/admin', rotulo: 'Resumen', icono: BarChart3 },
  { href: '/admin/detalle', rotulo: 'Detalle', icono: Table2 },
  { href: '/admin/historia', rotulo: 'Histórico', icono: TrendingUp },
  { href: '/admin/autopulido', rotulo: 'Auto-pulido', icono: Sparkles },
]

export function MarcoAdmin({
  titulo,
  subtitulo,
  filtros,
  children,
}: {
  titulo: string
  subtitulo: string
  filtros?: ReactNode
  children: ReactNode
}) {
  const ruta = usePathname()

  return (
    <div className="min-h-dvh bg-background pb-12">
      <TopBar title={titulo} subtitle={subtitulo} roleTag="Administración" />

      <nav className="border-b border-border bg-card">
        <ul className="mx-auto flex max-w-md gap-1 overflow-x-auto px-3 py-2">
          {SECCIONES.map((s) => {
            const activa = ruta === s.href
            return (
              <li key={s.href}>
                <Link
                  href={s.href}
                  aria-current={activa ? 'page' : undefined}
                  className={cn(
                    'flex h-11 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-semibold transition-colors',
                    activa ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
                  )}
                >
                  <s.icono className="h-4 w-4" />
                  {s.rotulo}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {filtros && (
        <div className="border-b border-border bg-card/60">
          <div className="mx-auto max-w-md px-4 py-3">{filtros}</div>
        </div>
      )}

      <main className="mx-auto max-w-md px-4">{children}</main>
    </div>
  )
}

/** Selector de mes y de bodega. Se alimenta de `/metricas/periodos`. */
export function Filtros({
  periodo,
  bodega,
  alCambiarPeriodo,
  alCambiarBodega,
  ocultarBodega,
}: {
  periodo: string
  bodega: string
  alCambiarPeriodo: (v: string) => void
  alCambiarBodega: (v: string) => void
  ocultarBodega?: boolean
}) {
  const [opciones, setOpciones] = useState<m.Periodos | null>(null)

  useEffect(() => {
    m.periodos()
      .then(setOpciones)
      // Sin filtros se sigue pudiendo mirar el mes en curso, que es el valor
      // por defecto del servidor. Fallar aquí no debe dejar la pantalla vacía.
      .catch(() => setOpciones(null))
  }, [])

  return (
    <div className={cn('grid gap-2', ocultarBodega ? 'grid-cols-1' : 'grid-cols-2')}>
      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Mes</span>
        <select
          value={periodo}
          onChange={(e) => alCambiarPeriodo(e.target.value)}
          className="h-11 w-full rounded-lg border-2 border-input bg-card px-2 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {(opciones?.periodos ?? [{ periodo, bodegasCerradas: 0, ultimoCierre: '', enCurso: true }]).map((p) => (
            <option key={p.periodo} value={p.periodo}>
              {m.nombreDeMes(p.periodo)}
              {p.enCurso ? ' · en curso' : ` · ${p.bodegasCerradas} cerradas`}
            </option>
          ))}
        </select>
      </label>

      {!ocultarBodega && (
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Bodega</span>
          <select
            value={bodega}
            onChange={(e) => alCambiarBodega(e.target.value)}
            className="h-11 w-full rounded-lg border-2 border-input bg-card px-2 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Todas las bodegas</option>
            {(opciones?.bodegas ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.nombre}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}

/** Cargando, error y vacío. Los tres estados que toda pantalla de datos tiene. */
export function Estado({
  cargando,
  error,
  vacio,
  mensajeVacio,
  alReintentar,
  children,
}: {
  cargando: boolean
  error: string | null
  vacio?: boolean
  mensajeVacio?: string
  alReintentar?: () => void
  children: ReactNode
}) {
  if (error) {
    return (
      <div className="mt-6 rounded-xl border-2 border-danger/30 bg-danger/10 p-4">
        <p className="flex items-start gap-2 text-sm font-semibold text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
        {alReintentar && (
          <button
            type="button"
            onClick={alReintentar}
            className="mt-3 h-11 w-full rounded-lg border-2 border-input bg-card font-display text-sm font-bold text-foreground"
          >
            Reintentar
          </button>
        )}
      </div>
    )
  }

  if (cargando) {
    return (
      <p className="mt-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Consultando…
      </p>
    )
  }

  if (vacio) {
    return (
      <p className="mt-10 text-center text-sm text-muted-foreground">
        {mensajeVacio ?? 'No hay datos para este mes.'}
      </p>
    )
  }

  return <>{children}</>
}

/**
 * El aviso de que un dato no está avalado todavía.
 *
 * Va en pantalla y no en un comentario porque la diferencia importa: un mes en
 * curso se mueve con cada ronda que cierra, y presentarlo con el mismo aspecto
 * que un mes firmado invita a llevárselo a un comité.
 */
export function Sello({ fuente }: { fuente: 'cierre' | 'proyeccion' | 'simulado' }) {
  if (fuente === 'cierre') return null
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
        fuente === 'proyeccion' ? 'bg-warning-soft text-warning-foreground' : 'bg-serie-fantasma/15 text-serie-fantasma',
      )}
    >
      {fuente === 'proyeccion' ? 'En curso · sin avalar' : 'Datos de ejemplo'}
    </span>
  )
}
