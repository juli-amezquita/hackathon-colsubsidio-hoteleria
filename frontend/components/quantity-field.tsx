'use client'

import { Minus, Plus } from 'lucide-react'
import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

export const QuantityField = forwardRef<
  HTMLInputElement,
  {
    value: number
    onChange: (value: number) => void
    invalid?: boolean
    id?: string
  }
>(({ value, onChange, invalid, id }, ref) => {
  const set = (n: number) => onChange(Math.max(0, n))
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-xl border-2 bg-card p-2 transition-colors focus-within:ring-2 focus-within:ring-primary/20',
        invalid ? 'border-warning-border' : 'border-input focus-within:border-primary',
      )}
    >
      <button
        type="button"
        aria-label="Restar uno"
        onClick={() => set(value - 1)}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-muted text-foreground transition-colors hover:bg-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
      >
        <Minus className="h-5 w-5" />
      </button>
      <input
        ref={ref}
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => set(Number.parseInt(e.target.value || '0', 10))}
        aria-invalid={invalid}
        className="min-w-0 flex-1 bg-transparent text-center font-display text-2xl font-extrabold text-foreground outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        aria-label="Sumar uno"
        onClick={() => set(value + 1)}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-[#00568f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
      >
        <Plus className="h-5 w-5" />
      </button>
    </div>
  )
})
QuantityField.displayName = 'QuantityField'
