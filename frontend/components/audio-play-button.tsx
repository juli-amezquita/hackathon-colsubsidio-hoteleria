'use client'

import { Loader2, Pause, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { getAudioUrl } from '@/lib/audio-store'
import { cn } from '@/lib/utils'

/**
 * Reproduce el clip de audio guardado en IndexedDB para una entrada del conteo.
 * Carga el blob bajo demanda y libera la object URL al desmontar.
 */
export function AudioPlayButton({
  audioId,
  label = 'Escuchar audio',
  className,
}: {
  audioId?: string
  label?: string
  className?: string
}) {
  const [loading, setLoading] = useState(false)
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
      audioRef.current = null
    }
  }, [])

  if (!audioId) return null

  async function toggle() {
    // Si ya está sonando, pausa
    if (playing && audioRef.current) {
      audioRef.current.pause()
      return
    }
    // Si ya cargó, reanuda
    if (audioRef.current) {
      audioRef.current.play().catch(() => setPlaying(false))
      return
    }
    // Primera reproducción: cargar el blob desde IndexedDB
    setLoading(true)
    const url = await getAudioUrl(audioId!)
    setLoading(false)
    if (!url) return
    urlRef.current = url
    const audio = new Audio(url)
    audioRef.current = audio
    audio.onplay = () => setPlaying(true)
    audio.onpause = () => setPlaying(false)
    audio.onended = () => setPlaying(false)
    audio.play().catch(() => setPlaying(false))
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : playing ? (
        <Pause className="h-3.5 w-3.5 text-primary" />
      ) : (
        <Play className="h-3.5 w-3.5 text-primary" />
      )}
      {playing ? 'Reproduciendo' : 'Audio'}
    </button>
  )
}
