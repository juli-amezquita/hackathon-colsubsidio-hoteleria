import { cn } from '@/lib/utils'

export function BrandLogo({
  className,
  showName = true,
}: {
  className?: string
  showName?: boolean
}) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span
        aria-hidden="true"
        className="relative grid h-8 w-8 place-items-center rounded-lg bg-primary"
      >
        <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-warning" />
        <span className="font-display text-[15px] font-extrabold leading-none text-primary-foreground">
          C
        </span>
      </span>
      {showName && (
        <span className="font-display text-base font-bold leading-none tracking-tight text-foreground">
          Colsubsidio
          <span className="ml-1 font-medium text-muted-foreground">Inventario</span>
        </span>
      )}
    </span>
  )
}
