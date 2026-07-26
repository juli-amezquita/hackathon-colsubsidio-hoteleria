'use client'

import type { Unit } from '@/lib/data'
import { cn } from '@/lib/utils'

const UNITS: Unit[] = ['unidad', 'kilogramo', 'litro', 'porcion']

export function UnitSelect({
  value,
  onChange,
}: {
  value: Unit
  onChange: (unit: Unit) => void
}) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Unidad de medida">
      {UNITS.map((u) => {
        const active = u === value
        return (
          <button
            key={u}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(u)}
            className={cn(
              'min-h-11 rounded-lg border-2 px-3 text-sm font-semibold capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'border-primary bg-primary-soft text-primary'
                : 'border-border bg-card text-muted-foreground hover:border-input',
            )}
          >
            {u}
          </button>
        )
      })}
    </div>
  )
}
