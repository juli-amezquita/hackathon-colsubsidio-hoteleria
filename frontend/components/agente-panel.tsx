'use client'

import { AlertTriangle, Keyboard, Loader2, Mic, MicOff, Volume2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { AgenteDeVoz, type Estado, type ItemConfirmado } from '@/lib/agente-voz'
import { cn } from '@/lib/utils'

/**
 * El conteo por voz, conversado.
 *
 * Antes era: el operario dictaba, el sistema escribía lo que oyó en un
 * formulario, y el operario tenía que teclear la cantidad que acababa de decir
 * en voz alta. Eso no es captura por voz — es dictarle a un formulario.
 *
 * Ahora el turno se cierra hablando:
 *
 *   — «diez paquetes de papas»
 *   — «Caja para papas paq x100, 10 unidades. ¿Confirmas?»
 *   — «sí»
 *   — «Registrado.»
 *
 * Lo escrito en pantalla es lo MISMO que se dice, no un resumen: en una bodega
 * con ruido, o con un operario con protección auditiva, el audio solo no llega
 * (Principio VIII pide las dos, y el Escenario 5 de la Historia 1 lo repite).
 */

const ROTULO: Record<Estado, string> = {
  apagado: 'Micrófono apagado',
  conectando: 'Conectando…',
  escuchando: 'Te escucho',
  hablando: 'Hablando…',
  silenciado: 'Micrófono en silencio',
  error: 'Error',
}

export interface Turno {
  quien: 'operario' | 'sistema'
  texto: string
}

export function AgentePanel({
  rondaId,
  onConfirmar,
  onHallazgo,
  onSostener,
  alertas,
  onEscribir,
}: {
  rondaId: string
  onConfirmar: (item: ItemConfirmado) => void
  /** Hallazgo: está en el estante y no en el catálogo (Historia 5). */
  onHallazgo: (item: ItemConfirmado) => void
  /** El operario sostiene su conteo pese a la alerta (FR-2.4). */
  onSostener: (registroId: string) => void
  /** Alertas que llegaron del servidor y siguen sin respuesta. */
  alertas: { registroId: string; articuloId: string | null; nombre: string; cantidad: number }[]
  /** Salida al modo manual, para cuando el ruido gana (FR-1.21). */
  onEscribir: () => void
}) {
  const [estado, setEstado] = useState<Estado>('apagado')
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [error, setError] = useState<string | null>(null)
  const [texto, setTexto] = useState('')
  const agenteRef = useRef<AgenteDeVoz | null>(null)
  const finRef = useRef<HTMLDivElement | null>(null)
  /** Alertas ya cantadas: sin esto se repetirían en cada render. */
  const dichas = useRef<Set<string>>(new Set())

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turnos])

  // Al salir de la pantalla se corta el micrófono. Sin esto seguiría abierto y
  // facturando audio de una bodega donde ya no hay nadie contando.
  useEffect(() => () => agenteRef.current?.desconectar(), [])

  const agregar = (quien: Turno['quien'], t: string) =>
    setTurnos((prev) => [...prev.slice(-20), { quien, texto: t }])

  // Una alerta que llega tarde se CANTA en cuanto llega.
  //
  // Es diferida por diseño: el conteo se confirma, se encola y el veredicto
  // vuelve cuando el operario ya va en otro artículo. Antes se quedaba muda y
  // reaparecía al final como un bloqueo que impedía cerrar la ronda y que nadie
  // sabía de dónde salía.
  useEffect(() => {
    const agente = agenteRef.current
    if (!agente) return
    for (const a of alertas) {
      if (dichas.current.has(a.registroId)) continue
      dichas.current.add(a.registroId)
      agente.avisarAlerta(a)
    }
  }, [alertas])

  async function encender() {
    setError(null)
    const agente = new AgenteDeVoz({
      alEscuchar: (t) => agregar('operario', t),
      alResponder: (t) => agregar('sistema', t),
      alConfirmar: onConfirmar,
      alHallar: onHallazgo,
      alSostener: onSostener,
      alCambiarEstado: setEstado,
      alAvisar: (m) => agregar('sistema', m),
      alFallar: setError,
    })
    agenteRef.current = agente
    await agente.conectar(rondaId)
  }

  function apagar() {
    agenteRef.current?.desconectar()
    agenteRef.current = null
  }

  const activo = estado === 'escuchando' || estado === 'hablando' || estado === 'silenciado'
  const mudo = estado === 'silenciado'

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {estado === 'hablando' ? (
            <Volume2 className="h-4 w-4 animate-pulse text-primary" />
          ) : estado === 'conectando' ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : mudo ? (
            <MicOff className="h-4 w-4 text-warning-foreground" />
          ) : activo ? (
            <Mic className="h-4 w-4 text-primary" />
          ) : (
            <MicOff className="h-4 w-4 text-muted-foreground" />
          )}
          {ROTULO[estado]}
        </p>
        {activo && !mudo && (
          <span className="flex items-center gap-1" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-3 w-1 animate-pulse rounded-full bg-primary"
                style={{ animationDelay: `${i * 140}ms` }}
              />
            ))}
          </span>
        )}
      </div>

      {/* La conversación. Es lo que se dijo, palabra por palabra. */}
      {turnos.length > 0 && (
        <div
          className="mt-4 max-h-64 space-y-2 overflow-y-auto"
          role="log"
          aria-live="polite"
          aria-label="Conversación con el agente"
        >
          {turnos.map((t, i) => (
            <p
              key={i}
              className={cn(
                'max-w-[85%] rounded-2xl px-3 py-2 text-sm',
                t.quien === 'operario'
                  ? 'ml-auto bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground',
              )}
            >
              {t.texto}
            </p>
          ))}
          <div ref={finRef} />
        </div>
      )}

      {error && (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-destructive/10 p-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        {/* Silenciar NO cierra la sesión: lo que se corta es el envío del
            micrófono. Cerrarla obligaría a pedir permiso otra vez en algunos
            navegadores y a rehacer la conexión con el proveedor. */}
        {activo && (
          <button
            type="button"
            onClick={() => agenteRef.current?.silenciar(!mudo)}
            aria-pressed={mudo}
            className={cn(
              'grid h-16 w-20 shrink-0 place-items-center rounded-xl border-2 font-display text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              mudo
                ? 'border-warning-border bg-warning/20 text-warning-foreground'
                : 'border-input bg-card text-foreground hover:bg-muted',
            )}
          >
            <span className="flex flex-col items-center gap-1">
              {mudo ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              {mudo ? 'Reanudar' : 'Silenciar'}
            </span>
          </button>
        )}

        <button
          type="button"
          onClick={activo ? apagar : () => void encender()}
          disabled={estado === 'conectando'}
          className={cn(
            'grid h-16 flex-1 place-items-center rounded-xl font-display text-base font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
            activo
              ? 'bg-destructive text-white'
              : 'bg-primary text-primary-foreground hover:bg-[#00568f]',
          )}
        >
          <span className="flex items-center gap-2">
            {activo ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            {activo ? 'Terminar' : 'Empezar a contar'}
          </span>
        </button>
      </div>

      {/* Escribir recorre el MISMO diálogo, respuesta hablada incluida
          (FR-1.6). No es un modo aparte: es el mismo agente por otro canal. */}
      {activo && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const t = texto.trim()
            if (!t) return
            agenteRef.current?.escribir(t)
            agregar('operario', t)
            setTexto('')
          }}
        >
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="…o escríbelo si hay mucho ruido"
            aria-label="Dictar por escrito"
            className="min-w-0 flex-1 rounded-lg border-2 border-input bg-card px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <button
            type="submit"
            className="shrink-0 rounded-lg bg-muted px-3 text-sm font-semibold text-foreground hover:bg-border"
          >
            Enviar
          </button>
        </form>
      )}

      <div className="mt-3 border-t border-border pt-3 text-center">
        <button
          type="button"
          onClick={onEscribir}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary underline-offset-2 hover:underline"
        >
          <Keyboard className="h-4 w-4" />
          Agregar con el formulario
        </button>
      </div>
    </section>
  )
}
