'use client'

import { CheckCircle2, Hammer, HelpCircle, PencilLine, ShieldCheck, Wrench } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Suspense, type ReactNode } from 'react'

import { Estado, Filtros, MarcoAdmin, Sello } from '@/components/admin/marco'
import { Cifra, COLOR, Leyenda, Linea, Proporcion } from '@/components/admin/graficos'
import { RequireRole } from '@/components/require-role'
import * as m from '@/lib/metricas'
import { cn } from '@/lib/utils'

/**
 * El AUTO-PULIDO: el sistema se examina a sí mismo, una vez al mes.
 *
 * ⚠️ **Evalúa a la máquina, NUNCA a la persona.** Es la decisión que fija la
 * migración 0015 y que este archivo hereda entera. Por eso el aviso no vive en
 * un comentario sino arriba del todo, en pantalla: un informe que califica
 * operarios se acaba usando contra ellos, y una herramienta que se usa contra
 * quien la opera se abandona — con ella se pierde el inventario. Aquí no entra
 * un nombre de operario, ni un ranking de personas, ni un "quién se equivocó
 * más". Lo que se mide es dónde falló la gramática.
 *
 * La otra regla de la pantalla es el sello: cuando el mes no tiene rondas
 * críticas suficientes, el servidor devuelve un ejemplo y lo dice con
 * `simulado: true`. Ese ejemplo se pinta etiquetado, no escondido. Un gráfico
 * de tendencia inventado y sin etiqueta es una mentira con ejes; con la
 * etiqueta es una maqueta honesta de dónde va a ir el dato.
 */

export default function PaginaAutopulido() {
  return (
    <RequireRole role="admin">
      {/* `useSearchParams` obliga a un límite de suspense: el filtro de mes vive
          en la URL para que el enlace se pueda compartir por chat. */}
      <Suspense fallback={null}>
        <Autopulido />
      </Suspense>
    </RequireRole>
  )
}

function Autopulido() {
  const router = useRouter()
  const ruta = usePathname()
  const params = useSearchParams()
  const periodo = params.get('mes') ?? mesEnBogota()

  const { datos, error, cargando, recargar } = m.useCarga(() => m.autopulido(periodo), [periodo])

  function fijarPeriodo(v: string) {
    const p = new URLSearchParams(params.toString())
    p.set('mes', v)
    router.replace(`${ruta}?${p.toString()}`, { scroll: false })
  }

  const simulado = datos?.simulado ?? false
  const sello = simulado ? <Sello fuente="simulado" /> : null

  return (
    <MarcoAdmin
      titulo="Auto-pulido"
      subtitulo="El sistema se examina a sí mismo"
      filtros={
        <Filtros
          periodo={periodo}
          bodega=""
          alCambiarPeriodo={fijarPeriodo}
          // El informe es del sistema entero, no de una bodega: la gramática es
          // una sola y se arregla una sola vez.
          alCambiarBodega={() => {}}
          ocultarBodega
        />
      }
    >
      <Advertencia />

      <Estado
        cargando={cargando}
        error={error}
        vacio={datos !== null && esVacio(datos)}
        mensajeVacio="Este mes todavía no tiene rondas cerradas con crítica, y tampoco hay propuestas vivas."
        alReintentar={recargar}
      >
        {datos && (
          <>
            {datos.simulado && <AvisoSimulado />}

            <p className="mt-5 text-xs text-muted-foreground">
              {m.nombreDeMes(datos.periodo)} · {m.numero(datos.rondasAnalizadas)}{' '}
              {datos.rondasAnalizadas === 1 ? 'ronda analizada' : 'rondas analizadas'} ·{' '}
              {m.numero(datos.registros)} {datos.registros === 1 ? 'registro' : 'registros'} dictados
            </p>

            {/* ---- Los tres índices del mes ---- */}
            <Titulo sello={sello}>Cómo le fue a la máquina este mes</Titulo>
            <div className="mt-2 grid grid-cols-1 gap-2">
              <Cifra
                icono={<CheckCircle2 className="h-3.5 w-3.5" />}
                rotulo="Entendió a la primera"
                valor={pct(datos.indice.aciertoGramatica)}
                nota="De cada 100 dictados, cuántos entendió la gramática sin ayuda."
              />
              <Cifra
                icono={<HelpCircle className="h-3.5 w-3.5" />}
                rotulo="Tuvo que preguntar"
                valor={pct(datos.indice.desambiguacion)}
                nota="De cada 100 dictados, cuántos obligaron a preguntar «¿cuál de estos?»."
              />
              <Cifra
                icono={<PencilLine className="h-3.5 w-3.5" />}
                rotulo="Hubo que corregir"
                valor={pct(datos.indice.correccion)}
                nota="De cada 100 dictados, cuántos se registraron mal y se rehicieron después."
              />
            </div>

            {/* ---- La tendencia ---- */}
            <Titulo sello={sello}>Cómo va cambiando, mes a mes</Titulo>
            <p className="mt-1 text-xs text-muted-foreground">
              Un gráfico por índice. Los tres se miden en porcentaje pero no significan lo mismo, y
              apilarlos en un solo eje dejaría que la escala decidiera la conclusión.
            </p>
            <div className="mt-2 space-y-3">
              <Tendencia
                rotulo="Entendió a la primera"
                color={COLOR.conciliado}
                puntos={datos.tendencia.map((t) => ({ x: m.nombreDeMes(t.periodo), y: t.aciertoGramatica }))}
              />
              <Tendencia
                rotulo="Tuvo que preguntar"
                color={COLOR.sobrante}
                puntos={datos.tendencia.map((t) => ({ x: m.nombreDeMes(t.periodo), y: t.desambiguacion }))}
              />
              <Tendencia
                rotulo="Hubo que corregir"
                color={COLOR.faltante}
                puntos={datos.tendencia.map((t) => ({ x: m.nombreDeMes(t.periodo), y: t.correccion }))}
              />
            </div>

            {/* ---- Los puntos flojos ---- */}
            <Titulo sello={sello}>Dónde se atasca</Titulo>
            <p className="mt-1 text-xs text-muted-foreground">
              Los fallos del sistema que más se repitieron, y la bodega donde más aparecen. Son
              defectos de la gramática, no descuidos de nadie.
            </p>
            <Hallazgos hallazgos={datos.hallazgos} />

            {/* ---- Las propuestas ---- */}
            <Titulo>Qué propone cambiar</Titulo>
            <p className="mt-1 text-xs text-muted-foreground">
              Estas <strong className="font-semibold text-foreground">sí son datos reales</strong>,
              incluso cuando el resto del mes es un ejemplo. No se filtran por mes: una propuesta
              viva en enero sigue viva en marzo, y esconderla al cambiar de filtro la haría volver
              como si fuera nueva.
            </p>
            <Propuestas propuestas={datos.propuestas} />
          </>
        )}
      </Estado>
    </MarcoAdmin>
  )
}

// ---------------------------------------------------------------------------
// El aviso que da sentido a todo lo demás
// ---------------------------------------------------------------------------

/**
 * Va arriba, siempre, aunque la carga falle.
 *
 * Es lo primero que se lee porque es lo que decide si esta pantalla se puede
 * enseñar en un comité sin que alguien pregunte "¿y quién lo hizo mal?".
 */
function Advertencia() {
  return (
    <section className="mt-4 rounded-xl border-2 border-primary/30 bg-primary-soft/40 p-3">
      <p className="flex items-start gap-2 font-display text-sm font-bold text-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        Esto evalúa a la máquina, nunca a la persona
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        En esta pantalla no hay nombres de operarios, ni ranking de personas, ni «quién se equivocó
        más». Lo que se mide es dónde falló el sistema: qué no entendió la gramática, qué obligó a
        preguntar «¿cuál de estos?» y qué hubo que corregir. Un informe que califica a quien cuenta
        se acaba usando contra ella, y una herramienta que se usa contra quien la opera se abandona
        — y con ella se pierde el inventario entero.
      </p>
    </section>
  )
}

function AvisoSimulado() {
  return (
    <section className="mt-3 rounded-xl border border-serie-fantasma/40 bg-card p-3">
      <Sello fuente="simulado" />
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Este mes todavía no tiene suficientes rondas cerradas con crítica, así que los índices, la
        tendencia y los puntos flojos que se ven abajo son un ejemplo que devuelve el servidor para
        enseñar la forma del informe — no una medición. Se llenarán solos en cuanto se cierren
        rondas reales; no hay que hacer nada. Las propuestas del final sí salen de datos reales.
      </p>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Piezas
// ---------------------------------------------------------------------------

function Titulo({ children, sello }: { children: ReactNode; sello?: ReactNode }) {
  return (
    <h2 className="mt-6 flex flex-wrap items-center gap-2 font-display text-base font-extrabold text-foreground">
      {children}
      {sello}
    </h2>
  )
}

/** Una serie, su leyenda y su tarjeta. El color nunca va solo. */
function Tendencia({ rotulo, color, puntos }: { rotulo: string; color: string; puntos: { x: string; y: number }[] }) {
  return (
    <section className="rounded-xl border border-border bg-card p-3">
      <Leyenda entradas={[{ rotulo, color }]} />
      <Linea puntos={puntos} color={color} formato={(n) => pct(n)} rotuloY={rotulo} />
    </section>
  )
}

function Hallazgos({ hallazgos }: { hallazgos: m.Autopulido['hallazgos'] }) {
  if (hallazgos.length === 0) {
    return (
      <p className="mt-3 rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">
        Ningún punto flojo detectado este mes. La gramática entendió todo lo que se le dictó.
      </p>
    )
  }

  // La proporción se mide contra el total de repeticiones del mes, no contra el
  // hallazgo mayor: así la barra dice "de todo lo que se atascó, esto fue tanto"
  // y no "esto es el peor", que con dos hallazgos siempre daría 100 %.
  const total = hallazgos.reduce((s, h) => s + h.veces, 0)

  return (
    <ul className="mt-3 space-y-3">
      {[...hallazgos]
        .sort((a, b) => b.veces - a.veces)
        .map((h) => (
          <li key={`${h.titulo}-${h.bodega ?? ''}`} className="rounded-xl border border-border bg-card p-3">
            <p className="text-sm font-semibold leading-snug text-foreground">{h.titulo}</p>
            <div className="mt-2">
              <Proporcion
                parte={h.veces}
                total={total}
                color={COLOR.faltante}
                rotulo={h.bodega ?? 'Bodega sin registrar'}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {m.numero(h.veces)} {h.veces === 1 ? 'vez' : 'veces'}
              {h.bodega ? `, sobre todo en ${h.bodega}` : ''}
            </p>
          </li>
        ))}
    </ul>
  )
}

const ESTADO: Record<string, { rotulo: string; clase: string }> = {
  propuesta: { rotulo: 'Propuesta', clase: 'bg-muted text-muted-foreground' },
  aprobada: { rotulo: 'Aprobada', clase: 'bg-warning-soft text-warning-foreground' },
  aplicada: { rotulo: 'Aplicada', clase: 'bg-success-soft text-success' },
}

function Propuestas({ propuestas }: { propuestas: m.Autopulido['propuestas'] }) {
  if (propuestas.length === 0) {
    return (
      <p className="mt-3 rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">
        No hay propuestas vivas. El sistema no ha encontrado nada que valga la pena cambiar todavía.
      </p>
    )
  }

  return (
    <ul className="mt-3 space-y-2.5">
      {propuestas.map((p) => {
        const estado = ESTADO[p.estado] ?? { rotulo: p.estado, clase: 'bg-muted text-muted-foreground' }
        return (
          <li key={p.id} className="rounded-xl border border-border bg-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{p.tipo}</span>
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                  estado.clase,
                )}
              >
                {estado.rotulo}
              </span>
            </div>

            <p className="mt-1.5 text-sm font-semibold leading-snug text-foreground">{p.accion}</p>

            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              <span className="font-semibold text-foreground">Evidencia:</span> {p.evidencia}
            </p>

            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
              <span className="text-[11px] tabular-nums text-muted-foreground">
                Detectada {m.numero(p.veces)} {p.veces === 1 ? 'vez' : 'veces'}
              </span>
              {/* `aplicable` no es "importante": es si un clic la resuelve. Cambiar
                  la gramática es escribir código, y decirlo evita que alguien
                  espere en el panel un botón que nunca va a existir. */}
              <span
                className={cn(
                  'inline-flex items-center gap-1 text-[11px] font-semibold',
                  p.aplicable ? 'text-success' : 'text-muted-foreground',
                )}
              >
                {p.aplicable ? <Wrench className="h-3 w-3" /> : <Hammer className="h-3 w-3" />}
                {p.aplicable ? 'Se aplica con un clic' : 'Requiere trabajo de una persona'}
              </span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/**
 * El servidor ya manda los índices en escala 0–100 (`91.4` es 91,4 %), y
 * `porcentaje()` espera una fracción. La división se hace aquí, en un solo
 * sitio, para no repartir un `/ 100` suelto por toda la pantalla.
 */
function pct(v: number | null): string {
  return m.porcentaje(v === null ? null : v / 100)
}

/**
 * El mes por defecto, en hora de Colombia.
 *
 * Es la misma cuenta que hace el controlador: el primer día del mes, entre las
 * 19:00 y la medianoche de Bogotá, el reloj UTC ya avanzó de mes y el panel
 * abriría en un mes que aquí todavía no empezó.
 */
function mesEnBogota(): string {
  const bogota = new Date(Date.now() - 5 * 60 * 60 * 1000)
  return `${bogota.getUTCFullYear()}-${String(bogota.getUTCMonth() + 1).padStart(2, '0')}`
}

function esVacio(d: m.Autopulido): boolean {
  return (
    d.tendencia.length === 0 &&
    d.hallazgos.length === 0 &&
    d.propuestas.length === 0 &&
    d.indice.aciertoGramatica === null
  )
}

// Sobre los tonos de `Cifra`: se dejan a propósito sin color. Pintar el acierto
// en verde por encima de un número exigiría fijar aquí qué se considera "bien",
// y ese umbral no lo ha puesto nadie todavía. Un color inventado se lee como
// una meta acordada.
