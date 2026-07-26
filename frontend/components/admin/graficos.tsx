'use client'

import { useId, useState, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * Los gráficos del tablero. SVG a mano, sin librería.
 *
 * No es purismo: el paquete de gráficos más pequeño que sirve pesa más que
 * todo el frontend de este producto junto, y estas pantallas se abren desde una
 * bodega con la señal que hay. Cuatro formas bastan para las preguntas que hace
 * la gerencia, y cuatro formas se escriben en un archivo.
 *
 * Reglas que se cumplen en todas ellas:
 *
 *  · **Ningún gráfico con dos ejes verticales.** Dos magnitudes distintas son
 *    dos gráficos. Un eje doble deja que la escala decida la conclusión.
 *  · **Un hueco no es un cero.** Un mes sin inventariar corta la línea; pintarlo
 *    en cero diría que se contó y no había diferencias, que es lo contrario.
 *  · **El color nunca va solo.** Cada serie lleva rótulo o leyenda; hay quien no
 *    distingue rojo de azul y hay quien lo imprime en blanco y negro.
 *  · **Todo gráfico tiene su tabla.** `<title>` por marca y, cuando la forma lo
 *    permite, cifra escrita al lado. Un lector de pantalla no ve el SVG.
 */

// ---------------------------------------------------------------------------
// Barras horizontales · comparar bodegas entre sí
// ---------------------------------------------------------------------------

export interface Tramo {
  clave: string
  rotulo: string
  valor: number
  color: string
}

/**
 * Una barra apilada por fila. Es la forma correcta para "comparar bodegas":
 * horizontal porque los nombres de bodega son largos (`STOCK RESTAURANTE
 * FUENTES SUMIN`) y en vertical habría que girarlos o recortarlos.
 */
export function BarrasApiladas({
  filas,
  leyenda,
  formato = (n) => n.toLocaleString('es-CO'),
}: {
  filas: { id: string; rotulo: string; tramos: Tramo[]; total: number; nota?: string }[]
  leyenda: { rotulo: string; color: string }[]
  formato?: (n: number) => string
}) {
  const maximo = Math.max(1, ...filas.map((f) => f.total))

  return (
    <div>
      <Leyenda entradas={leyenda} />
      <ul className="mt-3 space-y-2.5">
        {filas.map((f) => (
          <li key={f.id}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-xs font-semibold text-foreground">{f.rotulo}</span>
              <span className="shrink-0 font-display text-xs font-bold tabular-nums text-muted-foreground">
                {formato(f.total)}
                {f.nota && <span className="ml-1.5 font-sans font-normal">{f.nota}</span>}
              </span>
            </div>
            {/* `flex` con `gap` da el separador de 2px entre tramos sin cuentas:
                sin él, dos colores contiguos se leen como uno solo degradado. */}
            <div
              className="mt-1 flex h-5 gap-[2px] overflow-hidden rounded-[4px] bg-muted"
              style={{ width: `${Math.max(2, (f.total / maximo) * 100)}%` }}
              role="img"
              aria-label={`${f.rotulo}: ${f.tramos.map((t) => `${formato(t.valor)} ${t.rotulo}`).join(', ')}`}
            >
              {f.tramos
                .filter((t) => t.valor > 0)
                .map((t) => (
                  <span
                    key={t.clave}
                    className="h-full first:rounded-l-[4px] last:rounded-r-[4px]"
                    style={{ backgroundColor: t.color, flex: `${t.valor} 0 0` }}
                    title={`${t.rotulo}: ${formato(t.valor)}`}
                  />
                ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Leyenda({ entradas }: { entradas: { rotulo: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {entradas.map((e) => (
        <li key={e.rotulo} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: e.color }} aria-hidden />
          {e.rotulo}
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Línea temporal · una serie, doce meses
// ---------------------------------------------------------------------------

export interface PuntoSerie {
  x: string
  y: number | null
}

/**
 * Una sola serie a lo largo del tiempo, con los huecos declarados.
 *
 * Deliberadamente NO admite varias bodegas superpuestas. Ocho líneas en un
 * móvil son un ovillo, y para "comparar bodegas" la forma correcta son las
 * miniaturas de abajo (`RejillaDeMiniaturas`): el ojo compara ocho formas
 * pequeñas mucho mejor que ocho líneas cruzadas.
 */
export function Linea({
  puntos,
  color = 'var(--serie-sobrante)',
  alto = 140,
  formato = (n) => n.toLocaleString('es-CO'),
  rotuloY,
}: {
  puntos: PuntoSerie[]
  color?: string
  alto?: number
  formato?: (n: number) => string
  rotuloY?: string
}) {
  const id = useId()
  const [activo, setActivo] = useState<number | null>(null)

  const valores = puntos.map((p) => p.y).filter((v): v is number => v !== null)
  if (valores.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Todavía no hay meses cerrados que dibujar.</p>
  }

  const max = Math.max(...valores)
  const min = Math.min(0, ...valores)
  const rango = max - min || 1
  const ancho = 320
  const margen = { arriba: 8, abajo: 20, izq: 4, der: 4 }
  const util = { ancho: ancho - margen.izq - margen.der, alto: alto - margen.arriba - margen.abajo }

  const px = (i: number) => margen.izq + (puntos.length === 1 ? util.ancho / 2 : (i / (puntos.length - 1)) * util.ancho)
  const py = (v: number) => margen.arriba + util.alto - ((v - min) / rango) * util.alto

  // Los segmentos se cortan en los huecos: cada tramo continuo es su propio
  // `polyline`. Unirlos con una recta a través del hueco insinuaría una
  // evolución que nadie midió.
  const tramos: { i: number; v: number }[][] = []
  let actual: { i: number; v: number }[] = []
  puntos.forEach((p, i) => {
    if (p.y === null) {
      if (actual.length) tramos.push(actual)
      actual = []
    } else actual.push({ i, v: p.y })
  })
  if (actual.length) tramos.push(actual)

  const p = activo !== null ? puntos[activo] : null

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${ancho} ${alto}`}
        className="w-full"
        style={{ height: alto }}
        role="img"
        aria-labelledby={`${id}-t`}
        onMouseLeave={() => setActivo(null)}
      >
        <title id={`${id}-t`}>
          {rotuloY ?? 'Serie'}: {puntos.map((q) => `${q.x} ${q.y === null ? 'sin inventariar' : formato(q.y)}`).join('; ')}
        </title>

        <line x1={margen.izq} y1={py(min)} x2={ancho - margen.der} y2={py(min)} className="stroke-border" strokeWidth={1} />

        {tramos.map((t, k) => (
          <polyline
            key={k}
            points={t.map((q) => `${px(q.i)},${py(q.v)}`).join(' ')}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {puntos.map((q, i) =>
          q.y === null ? null : (
            <circle
              key={q.x}
              cx={px(i)}
              cy={py(q.y)}
              r={activo === i ? 5 : 3.5}
              fill={color}
              stroke="var(--card)"
              strokeWidth={2}
            />
          ),
        )}

        {/* Zonas de contacto anchas: el dedo no acierta un punto de 3px. */}
        {puntos.map((q, i) => (
          <rect
            key={`z-${q.x}`}
            x={px(i) - util.ancho / (puntos.length * 2)}
            y={0}
            width={util.ancho / puntos.length}
            height={alto}
            fill="transparent"
            onMouseEnter={() => setActivo(i)}
            onFocus={() => setActivo(i)}
            tabIndex={0}
            role="button"
            aria-label={`${q.x}: ${q.y === null ? 'sin inventariar' : formato(q.y)}`}
          />
        ))}

        {puntos.map((q, i) =>
          // Solo el primero y el último: una etiqueta por mes se convierte en
          // una franja negra ilegible en un móvil.
          i === 0 || i === puntos.length - 1 ? (
            <text key={`x-${q.x}`} x={px(i)} y={alto - 6} textAnchor={i === 0 ? 'start' : 'end'} className="fill-muted-foreground text-[9px]">
              {q.x}
            </text>
          ) : null,
        )}
      </svg>

      {p && (
        <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded-lg border border-border bg-card px-2 py-1 text-[11px] shadow-sm">
          <span className="font-semibold text-foreground">{p.x}</span>{' '}
          <span className="tabular-nums text-muted-foreground">
            {p.y === null ? 'sin inventariar' : formato(p.y)}
          </span>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Miniaturas · comparar muchas bodegas de un vistazo
// ---------------------------------------------------------------------------

/**
 * Una miniatura por bodega, todas con LA MISMA escala vertical.
 *
 * Esa es la única razón de que esto funcione: si cada miniatura se escalara a
 * su propio máximo, todas se verían igual de movidas y comparar sería
 * imposible — que es justo lo que pidió el cliente poder hacer.
 */
export function RejillaDeMiniaturas({
  series,
  meses,
  formato = (n) => n.toLocaleString('es-CO'),
  alSeleccionar,
}: {
  series: { id: string; rotulo: string; puntos: (number | null)[] }[]
  meses: string[]
  formato?: (n: number) => string
  alSeleccionar?: (id: string) => void
}) {
  const todos = series.flatMap((s) => s.puntos).filter((v): v is number => v !== null)
  const max = Math.max(1, ...todos)

  return (
    <ul className="grid grid-cols-2 gap-2">
      {series.map((s) => {
        const ultimo = [...s.puntos].reverse().find((v) => v !== null) ?? null
        return (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => alSeleccionar?.(s.id)}
              disabled={!alSeleccionar}
              className={cn(
                'w-full rounded-xl border border-border bg-card p-2.5 text-left',
                alSeleccionar && 'transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
            >
              <p className="truncate text-[11px] font-semibold text-foreground">{s.rotulo}</p>
              <p className="font-display text-lg font-extrabold leading-none tabular-nums text-foreground">
                {ultimo === null ? '—' : formato(ultimo)}
              </p>
              <Chispa puntos={s.puntos} max={max} />
              <p className="mt-0.5 text-[9px] text-muted-foreground">
                {meses[0]} — {meses[meses.length - 1]}
              </p>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function Chispa({ puntos, max }: { puntos: (number | null)[]; max: number }) {
  const ancho = 100
  const alto = 26
  const px = (i: number) => (puntos.length === 1 ? ancho / 2 : (i / (puntos.length - 1)) * ancho)
  const py = (v: number) => alto - (v / max) * (alto - 3) - 1.5

  const tramos: { i: number; v: number }[][] = []
  let actual: { i: number; v: number }[] = []
  puntos.forEach((v, i) => {
    if (v === null) {
      if (actual.length) tramos.push(actual)
      actual = []
    } else actual.push({ i, v })
  })
  if (actual.length) tramos.push(actual)

  return (
    <svg viewBox={`0 0 ${ancho} ${alto}`} className="mt-1 w-full" style={{ height: alto }} aria-hidden>
      {tramos.map((t, k) =>
        t.length === 1 ? (
          <circle key={k} cx={px(t[0]!.i)} cy={py(t[0]!.v)} r={2} fill="var(--serie-faltante)" />
        ) : (
          <polyline
            key={k}
            points={t.map((q) => `${px(q.i)},${py(q.v)}`).join(' ')}
            fill="none"
            stroke="var(--serie-faltante)"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ),
      )}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Piezas sueltas
// ---------------------------------------------------------------------------

/** La cifra grande. Cuando el dato es UNO, un gráfico solo lo estorba. */
export function Cifra({
  valor,
  rotulo,
  nota,
  tono,
  icono,
}: {
  valor: string
  rotulo: string
  nota?: string
  tono?: 'exito' | 'aviso' | 'peligro'
  icono?: ReactNode
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
        {icono}
        {rotulo}
      </p>
      <p
        className={cn(
          'mt-1 font-display text-2xl font-extrabold leading-none tabular-nums text-foreground',
          tono === 'exito' && 'text-success',
          tono === 'aviso' && 'text-warning-foreground',
          tono === 'peligro' && 'text-danger',
        )}
      >
        {valor}
      </p>
      {nota && <p className="mt-1 text-[11px] leading-tight text-muted-foreground">{nota}</p>}
    </div>
  )
}

/** Una proporción en una sola barra, con su cifra al lado. */
export function Proporcion({ parte, total, color, rotulo }: { parte: number; total: number; color: string; rotulo: string }) {
  const pct = total > 0 ? (parte / total) * 100 : 0
  return (
    <div>
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="text-muted-foreground">{rotulo}</span>
        <span className="font-display font-bold tabular-nums text-foreground">
          {parte.toLocaleString('es-CO')}
          <span className="ml-1 font-sans font-normal text-muted-foreground">{pct.toFixed(1)} %</span>
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  )
}

export const COLOR = {
  conciliado: 'var(--serie-conciliado)',
  sobrante: 'var(--serie-sobrante)',
  faltante: 'var(--serie-faltante)',
  fantasma: 'var(--serie-fantasma)',
  neutro: 'var(--serie-neutro)',
} as const
