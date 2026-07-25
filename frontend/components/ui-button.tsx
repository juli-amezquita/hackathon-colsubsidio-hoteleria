'use client'

import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const button = cva(
  'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-150 select-none outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-[#00568f] shadow-sm shadow-primary/20',
        warning: 'bg-warning text-warning-foreground hover:bg-warning-border',
        outline:
          'border-2 border-input bg-card text-foreground hover:border-primary hover:text-primary',
        ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
        success: 'bg-success text-success-foreground hover:bg-[#176e3c]',
        danger: 'bg-card text-danger border-2 border-danger/30 hover:border-danger hover:bg-danger/5',
      },
      size: {
        md: 'min-h-11 px-4 text-sm',
        lg: 'min-h-14 px-5 text-base',
        block: 'min-h-14 w-full px-5 text-base',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(button({ variant, size }), className)}
        disabled={disabled || loading}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {children}
      </button>
    )
  },
)
Button.displayName = 'Button'
