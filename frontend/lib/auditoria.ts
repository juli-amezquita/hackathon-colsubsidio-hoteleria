'use client'

import { useCallback, useEffect, useState } from 'react'

import * as api from '@/lib/api'

/**
 * El estado del Auditor. **Vive en el servidor, no en este dispositivo.**
 *
 * Las pantallas del Auditor leían `useCountStore`, que es la cola local del
 * operario: sus conteos, en su teléfono. Un Auditor audita conteos AJENOS —de
 * varias personas y varias rondas—, así que ahí no veía nada real. Podía
 * parecer que funcionaba mientras la misma persona hiciera los dos papeles en
 * el mismo navegador, que es exactamente como se probó.
 *
 * Aquí no hay caché ni estado optimista a propósito: el Auditor decide sobre
 * cifras que van al sistema central, y mostrarle una versión local que quizá no
 * coincide con el servidor es peor que hacerle esperar 200 ms.
 */

export interface Pendiente {
  articuloId: string | null
  fantasmaId: string | null
  nombre: string
  motivo: string
}

/** Cómo se lee un motivo. El catálogo es cerrado: si aparece otro, se muestra crudo. */
export const MOTIVO: Record<string, string> = {
  sin_cobertura: 'Nadie lo contó',
  discrepancia: 'No cuadra con el sistema',
  unidad_incorrecta: 'Unidad distinta a la esperada',
  producto_fantasma: 'Hallazgo sin catálogo',
  conflicto_entre_rondas: 'Las rondas no coinciden',
  resolucion_discrepante: 'El nombre se resolvió distinto',
}

export function leerMotivo(m: string | null): string {
  return m ? (MOTIVO[m] ?? m.replace(/_/g, ' ')) : 'Sin clasificar'
}

export function usePendientes(bodegaId: string | null) {
  const [items, setItems] = useState<Pendiente[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const recargar = useCallback(async () => {
    if (!bodegaId) return
    setError(null)
    try {
      setItems(await api.pendientesDeAuditoria(bodegaId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar la cola de auditoría.')
    }
  }, [bodegaId])

  useEffect(() => {
    void recargar()
  }, [recargar])

  return { items, error, recargar }
}

export function useCodigosRazon() {
  const [codigos, setCodigos] = useState<{ id: string; descripcion: string }[]>([])
  useEffect(() => {
    api
      .codigosDeRazon()
      .then(setCodigos)
      // Sin códigos no se puede resolver nada, pero la lista de casos SÍ se
      // puede leer. Fallar aquí no debe dejar al Auditor sin ver su trabajo.
      .catch(() => setCodigos([]))
  }, [])
  return codigos
}
