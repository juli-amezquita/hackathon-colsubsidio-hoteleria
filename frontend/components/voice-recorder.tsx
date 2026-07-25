'use client'

import { Loader2, Mic, Square } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

type Status = 'idle' | 'grabando' | 'procesando'

// Tipos mínimos para la Web Speech API (no incluidos en el DOM lib por defecto)
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: any) => void) | null
  onerror: ((event: any) => void) | null
  onend: (() => void) | null
}

function getRecognition(): SpeechRecognitionLike | null {
  if (typeof window === 'undefined') return null
  const Ctor =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  if (!Ctor) return null
  const rec: SpeechRecognitionLike = new Ctor()
  rec.lang = 'es-CO'
  rec.continuous = true
  rec.interimResults = true
  return rec
}

export function VoiceRecorder({
  onResult,
  onLiveTranscript,
}: {
  onResult: (transcript: string, audioBlob: Blob | null) => void
  onLiveTranscript?: (transcript: string) => void
}) {
  const [status, setStatus] = useState<Status>('idle')
  const [interim, setInterim] = useState('')
  const [micDenied, setMicDenied] = useState(false)
  const [supported, setSupported] = useState(true)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const barsRef = useRef<number[]>([])
  const finalRef = useRef('')
  // Grabación del audio real para guardarlo en IndexedDB
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  useEffect(() => {
    setSupported(Boolean(getRecognition()))
  }, [])

  // Detiene solo el waveform (RAF + AudioContext), manteniendo vivo el stream
  // hasta que el MediaRecorder termine de escribir el blob.
  const stopWaveform = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {})
    }
    audioCtxRef.current = null
    analyserRef.current = null
  }, [])

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  const cleanupAudio = useCallback(() => {
    stopWaveform()
    stopStream()
  }, [stopWaveform, stopStream])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const analyser = analyserRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr
      canvas.height = h * dpr
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    // Nueva muestra de amplitud
    let amp = 0.04
    if (analyser) {
      const data = new Uint8Array(analyser.fftSize)
      analyser.getByteTimeDomainData(data)
      let sum = 0
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128
        sum += v * v
      }
      amp = Math.min(1, Math.sqrt(sum / data.length) * 3.2)
    }
    barsRef.current.push(amp)

    const barW = 4
    const gap = 3
    const maxBars = Math.floor(w / (barW + gap))
    if (barsRef.current.length > maxBars) {
      barsRef.current = barsRef.current.slice(-maxBars)
    }

    const bars = barsRef.current
    const mid = h / 2
    ctx.fillStyle = '#0067b1'
    for (let i = 0; i < bars.length; i++) {
      const x = w - (bars.length - i) * (barW + gap)
      const barH = Math.max(3, bars[i] * (h - 8))
      const r = barW / 2
      const y = mid - barH / 2
      // barra redondeada
      ctx.beginPath()
      ctx.roundRect(x, y, barW, barH, r)
      ctx.fill()
    }

    rafRef.current = requestAnimationFrame(draw)
  }, [])

  const finalize = useCallback(
    (text: string, blob: Blob | null) => {
      onResult(text, blob)
      setStatus('idle')
      setInterim('')
      finalRef.current = ''
      barsRef.current = []
      chunksRef.current = []
    },
    [onResult],
  )

  const stopAll = useCallback(
    (fire: boolean) => {
      recognitionRef.current?.stop()

      if (!fire) {
        cleanupAudio()
        mediaRecorderRef.current = null
        setStatus('idle')
        return
      }

      setStatus('procesando')
      stopWaveform()
      const text = finalRef.current.trim() || interim.trim()
      const recorder = mediaRecorderRef.current

      if (recorder && recorder.state !== 'inactive') {
        // Esperamos a que el MediaRecorder cierre el blob antes de finalizar
        recorder.onstop = () => {
          const type = recorder.mimeType || 'audio/webm'
          const blob = chunksRef.current.length ? new Blob(chunksRef.current, { type }) : null
          stopStream()
          mediaRecorderRef.current = null
          finalize(text, blob)
        }
        try {
          recorder.stop()
        } catch {
          stopStream()
          mediaRecorderRef.current = null
          finalize(text, null)
        }
      } else {
        stopStream()
        window.setTimeout(() => finalize(text, null), 500)
      }
    },
    [cleanupAudio, finalize, interim, stopStream, stopWaveform],
  )

  const start = useCallback(async () => {
    setMicDenied(false)
    setInterim('')
    finalRef.current = ''
    barsRef.current = []
    chunksRef.current = []

    // 1) Audio para el waveform en tiempo real + grabación del clip
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      const audioCtx = new AudioCtx()
      audioCtxRef.current = audioCtx
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 1024
      source.connect(analyser)
      analyserRef.current = analyser

      // Grabar el audio real para persistirlo en IndexedDB
      if (typeof MediaRecorder !== 'undefined') {
        try {
          const recorder = new MediaRecorder(stream)
          mediaRecorderRef.current = recorder
          recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
          }
          recorder.start()
        } catch {
          mediaRecorderRef.current = null
        }
      }
    } catch {
      setMicDenied(true)
    }

    setStatus('grabando')
    rafRef.current = requestAnimationFrame(draw)

    // 2) Reconocimiento de voz
    const rec = getRecognition()
    if (rec) {
      recognitionRef.current = rec
      rec.onresult = (event: any) => {
        let finalText = ''
        let interimText = ''
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i]
          if (res.isFinal) finalText += res[0].transcript
          else interimText += res[0].transcript
        }
        if (finalText) finalRef.current += finalText + ' '
        const live = (finalRef.current + interimText).trim()
        setInterim(live)
        onLiveTranscript?.(live)
      }
      rec.onerror = (e: any) => {
        if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') {
          setMicDenied(true)
        }
      }
      rec.onend = () => {
        // el usuario detiene manualmente; si sigue en grabando, reiniciamos
        if (status === 'grabando' && recognitionRef.current) {
          try {
            recognitionRef.current.start()
          } catch {
            /* noop */
          }
        }
      }
      try {
        rec.start()
      } catch {
        /* ya iniciado */
      }
    }
  }, [draw, onLiveTranscript, status])

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort()
      try {
        mediaRecorderRef.current?.stop()
      } catch {
        /* noop */
      }
      mediaRecorderRef.current = null
      cleanupAudio()
    }
  }, [cleanupAudio])

  const isRecording = status === 'grabando'
  const isProcessing = status === 'procesando'

  return (
    <div className="flex flex-col items-center">
      {/* Waveform */}
      <div
        className={cn(
          'relative flex h-24 w-full items-center justify-center overflow-hidden rounded-2xl border-2 transition-colors',
          isRecording
            ? 'border-primary/30 bg-primary-soft/40'
            : 'border-dashed border-border bg-muted/50',
        )}
      >
        {isRecording ? (
          <canvas ref={canvasRef} className="h-full w-full" aria-hidden="true" />
        ) : (
          <p className="px-4 text-center text-sm text-muted-foreground">
            {isProcessing
              ? 'Procesando tu voz…'
              : 'Presiona el micrófono y di el producto, la cantidad y la unidad.'}
          </p>
        )}
        {isRecording && (
          <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-card/90 px-2 py-1 text-[11px] font-semibold text-danger">
            <span className="h-2 w-2 animate-pulse rounded-full bg-danger" />
            REC
          </span>
        )}
      </div>

      {/* Botón de grabación con 3 estados */}
      <button
        type="button"
        onClick={() => {
          if (status === 'idle') start()
          else if (status === 'grabando') stopAll(true)
        }}
        disabled={isProcessing}
        aria-label={
          isRecording ? 'Detener grabación' : isProcessing ? 'Procesando' : 'Iniciar grabación'
        }
        className={cn(
          'relative mt-6 grid h-24 w-24 place-items-center rounded-full transition-all duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30 active:scale-95 disabled:cursor-wait',
          isRecording
            ? 'bg-danger text-danger-foreground shadow-lg shadow-danger/30'
            : isProcessing
              ? 'bg-muted text-muted-foreground'
              : 'bg-primary text-primary-foreground shadow-lg shadow-primary/30',
        )}
      >
        {isRecording && (
          <span className="absolute inset-0 animate-ping rounded-full bg-danger/40" aria-hidden="true" />
        )}
        {isProcessing ? (
          <Loader2 className="h-8 w-8 animate-spin" />
        ) : isRecording ? (
          <Square className="h-8 w-8 fill-current" />
        ) : (
          <Mic className="h-9 w-9" />
        )}
      </button>

      <p className="mt-3 min-h-5 text-sm font-semibold text-foreground">
        {isRecording ? 'Grabando… toca para detener' : isProcessing ? 'Procesando…' : 'Toca para hablar'}
      </p>

      {/* Transcripción en vivo */}
      <div className="mt-3 min-h-12 w-full rounded-xl bg-muted px-3 py-2 text-center">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Transcripción</p>
        <p className="text-pretty text-sm text-foreground">
          {interim || <span className="text-muted-foreground/60">Esperando tu voz…</span>}
        </p>
      </div>

      {/* Avisos de disponibilidad */}
      {!supported && (
        <p className="mt-2 text-center text-xs text-warning-foreground">
          Este navegador no reconoce voz automáticamente. Puedes ingresar la cantidad manualmente al
          confirmar.
        </p>
      )}
      {micDenied && supported && (
        <p className="mt-2 text-center text-xs text-warning-foreground">
          No se pudo acceder al micrófono. Revisa los permisos o ingresa la cantidad manualmente.
        </p>
      )}
    </div>
  )
}
