'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Quién está contando dónde, en vivo.
 *
 * Dos operarios en la misma bodega **no es un fallo**: una ronda es el recorrido
 * de una persona, no se pisan entre sí y se acumulan. Lo que faltaba era que se
 * enteraran — el equipo descubría el solape cuando ya estaba hecho.
 *
 * Por eso esto avisa y no impide. Y trae nombres y conteos de rondas, **nunca
 * cantidades**: saber que un compañero registró treinta panes acabaría con el
 * conteo ciego, que es sobre lo que se apoya toda la conciliación.
 */

export interface Presente {
  usuarioId: string
  nombre: string
  desde: string
}

export interface EstadoBodega {
  bodegaId: string
  presentes: Presente[]
  rondasCerradas: number
  rondasAbiertas: number
}

/** Cada cuánto se renueva la presencia. Debe ser holgadamente menor que los 45 s de vida en Redis. */
const LATIDO_MS = 15_000

export function usePresencia(activa: { bodegaId: string; nombre: string } | null) {
  const [estado, setEstado] = useState<Record<string, EstadoBodega>>({})
  const wsRef = useRef<WebSocket | null>(null)
  const activaRef = useRef(activa)
  activaRef.current = activa

  useEffect(() => {
    let vivo = true
    let reintento: ReturnType<typeof setTimeout> | null = null

    const conectar = () => {
      if (!vivo) return
      const protocolo = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${protocolo}//${location.host}/presencia`)
      wsRef.current = ws

      ws.onmessage = (e) => {
        try {
          const m = JSON.parse(String(e.data)) as { tipo?: string; bodegas?: EstadoBodega[] }
          if (m.tipo === 'estado' && m.bodegas) {
            setEstado(Object.fromEntries(m.bodegas.map((b) => [b.bodegaId, b])))
          }
        } catch {
          /* marco inválido: se ignora */
        }
      }

      ws.onopen = () => {
        const a = activaRef.current
        if (a) ws.send(JSON.stringify({ tipo: 'entrar', ...a }))
      }

      // Reconecta sola. Una vista "en vivo" que se queda congelada tras un
      // microcorte de Wi-Fi es peor que no tenerla: sigue pareciendo actual.
      ws.onclose = () => {
        if (!vivo) return
        reintento = setTimeout(conectar, 3000)
      }
    }

    conectar()

    // El latido renueva la presencia. Si el navegador se cierra de golpe —lo
    // normal en un móvil— deja de latir y Redis lo olvida solo.
    const latido = setInterval(() => {
      const a = activaRef.current
      if (a && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ tipo: 'entrar', ...a }))
      }
    }, LATIDO_MS)

    return () => {
      vivo = false
      clearInterval(latido)
      if (reintento) clearTimeout(reintento)
      const a = activaRef.current
      if (a && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ tipo: 'salir', bodegaId: a.bodegaId }))
      }
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [])

  // Entrar a una bodega distinta se anuncia enseguida, sin esperar al latido:
  // el compañero que ya está allí debe verlo llegar, no medio minuto después.
  useEffect(() => {
    if (activa && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ tipo: 'entrar', ...activa }))
    }
  }, [activa?.bodegaId, activa?.nombre])

  return estado
}
