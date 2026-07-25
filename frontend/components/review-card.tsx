'use client'

import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  HelpCircle,
  Pencil,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { AudioPlayButton } from '@/components/audio-play-button'
import { QuantityField } from '@/components/quantity-field'
import { UnitSelect } from '@/components/unit-select'
import { Button } from '@/components/ui-button'
import type { Unit } from '@/lib/data'
import { ANOMALY_MAX, formatUnit } from '@/lib/inventory'
import type { CountEntry, Review } from '@/lib/store'
import { cn } from '@/lib/utils'

interface ReviewCardProps {
  entry: CountEntry
  review?: Review
  defaultOpen?: boolean
  onReview: (review: Review) => void
}

export function ReviewCard({ entry, review, defaultOpen = false, onReview }: ReviewCardProps) {
  const [open, setOpen] = useState(defaultOpen)
  const [mode, setMode] = useState<'idle' | 'editing'>('idle')
  const [qty, setQty] = useState(review?.auditorQuantity ?? entry.quantity)
  const [unit, setUnit] = useState<Unit>(review?.auditorUnit ?? entry.unit)
  const [note, setNote] = useState(review?.note ?? '')

  const flags: { icon: typeof AlertTriangle; text: string }[] = []
  if (entry.needsReview)
    flags.push({ icon: HelpCircle, text: 'El audio no fue claro al capturarlo. Verifica los datos.' })
  if (entry.isAnomaly)
    flags.push({ icon: AlertTriangle, text: 'El afiliado marcó esta cantidad como inusual y la confirmó.' })
  if (entry.isDuplicate)
    flags.push({ icon: Copy, text: 'Este producto fue contado más de una vez.' })

  const correctedAnomaly = qty > ANOMALY_MAX || qty <= 0
  const reviewed = !!review

  function approve() {
    onReview({
      status: 'aprobado',
      auditorQuantity: entry.quantity,
      auditorUnit: entry.unit,
      note: note.trim(),
    })
    setMode('idle')
    setOpen(false)
  }

  function saveCorrection() {
    onReview({
      status: 'corregido',
      auditorQuantity: qty,
      auditorUnit: unit,
      note: note.trim(),
    })
    setMode('idle')
    setOpen(false)
  }

  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl border-2 bg-card shadow-sm transition-colors',
        flags.length > 0 && !reviewed ? 'border-warning-border' : 'border-border',
      )}
    >
      {/* Cabecera colapsable */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={open}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-display text-base font-bold text-foreground">{entry.name}</p>
            {flags.length > 0 && !reviewed && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning-soft px-1.5 py-0.5 text-warning-foreground">
                {entry.needsReview && <HelpCircle className="h-3 w-3" />}
                {entry.isAnomaly && <AlertTriangle className="h-3 w-3" />}
                {entry.isDuplicate && <Copy className="h-3 w-3" />}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {formatUnit(entry.quantity, entry.unit)}
            {review && review.status === 'corregido' && (
              <span className="text-primary">
                {' '}
                → {formatUnit(review.auditorQuantity, review.auditorUnit)}
              </span>
            )}
          </p>
        </div>

        {review ? (
          <span
            className={cn(
              'shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold',
              review.status === 'aprobado' ? 'bg-success-soft text-success' : 'bg-primary-soft text-primary',
            )}
          >
            {review.status === 'aprobado' ? 'Aprobado' : 'Corregido'}
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-[11px] font-semibold text-muted-foreground">
            Pendiente
          </span>
        )}

        <ChevronDown
          className={cn(
            'h-5 w-5 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {/* Cuerpo expandido */}
      {open && (
        <div className="border-t border-border p-4">
          {/* Conteo del afiliado */}
          <div className="rounded-xl bg-muted p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Reportado por el afiliado
            </p>
            <p className="mt-1 font-display text-2xl font-extrabold text-foreground">
              {formatUnit(entry.quantity, entry.unit)}
            </p>
            {entry.transcript && (
              <p className="mt-2 border-t border-border pt-2 text-xs italic text-muted-foreground">
                &ldquo;{entry.transcript}&rdquo;
              </p>
            )}
            {entry.audioId && (
              <div className="mt-2">
                <AudioPlayButton audioId={entry.audioId} label={`Escuchar audio de ${entry.name}`} />
              </div>
            )}
          </div>

          {/* Alertas del ítem */}
          {flags.length > 0 && (
            <ul className="mt-3 space-y-2">
              {flags.map((f, i) => {
                const Icon = f.icon
                return (
                  <li
                    key={i}
                    className="flex items-start gap-2 rounded-xl border-2 border-warning-border bg-warning-soft p-3"
                  >
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" />
                    <p className="text-sm text-warning-foreground">{f.text}</p>
                  </li>
                )
              })}
            </ul>
          )}

          {/* Zona de corrección */}
          {mode === 'editing' && (
            <div className="mt-4">
              <label
                htmlFor={`qty-${entry.id}`}
                className="mb-2 block text-sm font-semibold text-foreground"
              >
                Cantidad corregida
              </label>
              <QuantityField id={`qty-${entry.id}`} value={qty} onChange={setQty} invalid={correctedAnomaly} />
              <div className="mt-3">
                <UnitSelect value={unit} onChange={setUnit} />
              </div>
              <div className="mt-1 min-h-5">
                {correctedAnomaly && (
                  <p className="text-xs text-warning-foreground">
                    Esta cantidad también parece inusual. Verifícala.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Nota */}
          <div className="mt-3">
            <label
              htmlFor={`note-${entry.id}`}
              className="mb-2 block text-sm font-semibold text-foreground"
            >
              Nota del auditor <span className="font-normal text-muted-foreground">(opcional)</span>
            </label>
            <textarea
              id={`note-${entry.id}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Observaciones sobre este conteo…"
              className="w-full resize-none rounded-xl border-2 border-input bg-card p-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* Acciones */}
          {mode === 'editing' ? (
            <div className="mt-4 flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setMode('idle')}>
                <X className="h-[18px] w-[18px]" />
                Cancelar
              </Button>
              <Button variant="primary" className="flex-1" onClick={saveCorrection} disabled={qty <= 0}>
                <Check className="h-[18px] w-[18px]" />
                Guardar
              </Button>
            </div>
          ) : (
            <div className="mt-4 flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setMode('editing')}>
                <Pencil className="h-[18px] w-[18px]" />
                Corregir
              </Button>
              <Button variant="success" className="flex-1" onClick={approve}>
                <Check className="h-[18px] w-[18px]" />
                {reviewed ? 'Confirmar' : 'Aprobar'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
