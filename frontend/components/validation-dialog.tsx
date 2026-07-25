'use client'

import { AlertTriangle, Copy, HelpCircle } from 'lucide-react'
import { useEffect } from 'react'
import { Button } from '@/components/ui-button'
import { formatUnit } from '@/lib/inventory'

export type AlertKind = 'anomaly' | 'duplicate' | 'unclear'

export interface ValidationAlert {
  kind: AlertKind
  detail: string
}

const ICONS: Record<AlertKind, typeof AlertTriangle> = {
  anomaly: AlertTriangle,
  duplicate: Copy,
  unclear: HelpCircle,
}

const TITLES: Record<AlertKind, string> = {
  anomaly: 'Cantidad inusual',
  duplicate: 'Producto repetido',
  unclear: 'No se entendió bien',
}

export function ValidationDialog({
  open,
  name,
  quantity,
  unit,
  alerts,
  onConfirm,
  onCorrect,
}: {
  open: boolean
  name: string
  quantity: number
  unit: string
  alerts: ValidationAlert[]
  onConfirm: () => void
  onCorrect: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCorrect()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onCorrect])

  if (!open || alerts.length === 0) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-foreground/40 backdrop-blur-sm"
        onClick={onCorrect}
        aria-hidden="true"
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="validation-title"
        className="relative w-full max-w-md animate-in slide-in-from-bottom-4 rounded-t-3xl border-t-4 border-warning bg-card p-5 shadow-2xl sm:rounded-3xl sm:border-t-0"
      >
        <div className="mb-4 flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-warning">
            <AlertTriangle className="h-6 w-6 text-warning-foreground" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-warning-foreground">
              Revisa antes de agregar
            </p>
            <h2 id="validation-title" className="font-display text-lg font-extrabold text-foreground">
              {name || 'Producto'}
            </h2>
          </div>
        </div>

        {/* Lista de motivos de validación */}
        <ul className="space-y-2">
          {alerts.map((a) => {
            const Icon = ICONS[a.kind]
            return (
              <li
                key={a.kind}
                className="flex items-start gap-3 rounded-xl bg-warning-soft p-3"
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" />
                <div>
                  <p className="text-sm font-semibold text-foreground">{TITLES[a.kind]}</p>
                  <p className="text-xs leading-relaxed text-warning-foreground/90">{a.detail}</p>
                </div>
              </li>
            )
          })}
        </ul>

        {quantity > 0 && (
          <div className="mt-4 rounded-2xl bg-muted p-4 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Cantidad registrada
            </p>
            <p className="mt-1 font-display text-3xl font-extrabold text-foreground">{quantity}</p>
            <p className="text-xs text-muted-foreground">{unit}</p>
          </div>
        )}

        <div className="mt-5 flex flex-col gap-2">
          <Button variant="warning" size="block" onClick={onConfirm}>
            Agregar de todas formas
          </Button>
          <Button variant="outline" size="block" onClick={onCorrect}>
            Corregir
          </Button>
        </div>
        <p className="sr-only" aria-live="polite">
          {name} {formatUnit(quantity, unit)}. Revisa la información antes de agregar.
        </p>
      </div>
    </div>
  )
}
