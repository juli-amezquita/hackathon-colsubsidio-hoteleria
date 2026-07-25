'use client'

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  helper?: string
  error?: string
  icon?: ReactNode
  trailing?: ReactNode
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  ({ label, helper, error, icon, trailing, className, disabled, id, ...props }, ref) => {
    const autoId = useId()
    const inputId = id ?? autoId
    const invalid = Boolean(error)

    return (
      <div className="w-full">
        <label
          htmlFor={inputId}
          className="mb-1.5 block text-sm font-semibold text-foreground"
        >
          {label}
        </label>
        <div
          className={cn(
            'flex items-center gap-2 rounded-xl border-2 bg-card px-3 transition-colors',
            'focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20',
            invalid && 'border-danger focus-within:border-danger focus-within:ring-danger/20',
            !invalid && 'border-input',
            disabled && 'cursor-not-allowed bg-muted opacity-70',
          )}
        >
          {icon && <span className="shrink-0 text-muted-foreground">{icon}</span>}
          <input
            ref={ref}
            id={inputId}
            disabled={disabled}
            aria-invalid={invalid}
            aria-describedby={`${inputId}-helper`}
            className={cn(
              'min-h-11 w-full bg-transparent py-2 text-base text-foreground outline-none placeholder:text-muted-foreground/60 disabled:cursor-not-allowed',
              className,
            )}
            {...props}
          />
          {trailing && <span className="shrink-0">{trailing}</span>}
        </div>
        {/* Altura reservada para evitar saltos de layout */}
        <p
          id={`${inputId}-helper`}
          className={cn(
            'mt-1 min-h-4 text-xs leading-tight',
            invalid ? 'text-danger' : 'text-muted-foreground',
          )}
        >
          {error ?? helper ?? '\u00A0'}
        </p>
      </div>
    )
  },
)
TextField.displayName = 'TextField'
