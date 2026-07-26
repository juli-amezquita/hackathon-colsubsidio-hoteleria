'use client'

import { ChevronLeft, LogOut } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { BrandLogo } from '@/components/brand-logo'
import { useCountStore } from '@/lib/store'
import { cn } from '@/lib/utils'

export function TopBar({
  title,
  subtitle,
  backHref,
  roleTag,
}: {
  title?: string
  subtitle?: string
  backHref?: string
  roleTag?: 'Afiliado' | 'Auditor'
}) {
  const router = useRouter()
  const { session, logout } = useCountStore()

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <div className="mx-auto flex h-14 max-w-md items-center gap-2 px-4">
        {backHref ? (
          <button
            type="button"
            onClick={() => router.push(backHref)}
            aria-label="Volver"
            className="-ml-2 grid h-11 w-11 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        ) : (
          <BrandLogo showName={false} />
        )}

        <div className="min-w-0 flex-1">
          {title ? (
            <p className="truncate font-display text-sm font-bold leading-tight text-foreground">
              {title}
            </p>
          ) : (
            <p className="truncate font-display text-sm font-bold leading-tight text-foreground">
              Colsubsidio
            </p>
          )}
          {subtitle && (
            <p className="truncate text-xs leading-tight text-muted-foreground">{subtitle}</p>
          )}
        </div>

        {roleTag && (
          <span
            className={cn(
              'rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide',
              roleTag === 'Afiliado'
                ? 'bg-primary-soft text-primary'
                : 'bg-warning-soft text-warning-foreground',
            )}
          >
            {roleTag}
          </span>
        )}

        {session && (
          <button
            type="button"
            onClick={() => {
              logout()
              router.push('/')
            }}
            aria-label="Cerrar sesión"
            className="grid h-11 w-11 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <LogOut className="h-[18px] w-[18px]" />
          </button>
        )}
      </div>
    </header>
  )
}
