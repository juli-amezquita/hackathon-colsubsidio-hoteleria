'use client'

import { AlertTriangle, ChevronDown, ChevronLeft, CheckCircle2, FileCheck2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { ProgressBar } from '@/components/progress-bar'
import { RequireRole } from '@/components/require-role'
import { ReviewCard } from '@/components/review-card'
import { TopBar } from '@/components/top-bar'
import { Button } from '@/components/ui-button'
import { orderedEntries } from '@/lib/inventory'
import { useCountStore, type Review } from '@/lib/store'
import { cn } from '@/lib/utils'

export default function AuditorVerifyPage() {
  return (
    <RequireRole role="auditor">
      <AuditorVerify />
    </RequireRole>
  )
}

function AuditorVerify() {
  const router = useRouter()
  const { ready, activeWarehouseId, active, reviewItem, getWarehouse } = useCountStore()

  const warehouse = getWarehouse(activeWarehouseId)
  const ordered = useMemo(() => (active ? orderedEntries(active.entries) : []), [active])
  const reviews = active?.reviews ?? {}

  const flagged = useMemo(
    () => ordered.filter((e) => e.isAnomaly || e.isDuplicate || e.needsReview),
    [ordered],
  )
  const normal = useMemo(
    () => ordered.filter((e) => !(e.isAnomaly || e.isDuplicate || e.needsReview)),
    [ordered],
  )

  const [showNormal, setShowNormal] = useState(false)

  useEffect(() => {
    if (ready && (!activeWarehouseId || !active || active.entries.length === 0 || !active.submitted)) {
      router.replace('/auditor')
    }
  }, [ready, activeWarehouseId, active, router])

  if (!warehouse || ordered.length === 0) return null

  const reviewedCount = ordered.filter((e) => reviews[e.id]).length
  const pct = Math.round((reviewedCount / ordered.length) * 100)
  const flaggedReviewed = flagged.filter((e) => reviews[e.id]).length
  const firstPendingFlaggedId = flagged.find((e) => !reviews[e.id])?.id
  const allReviewed = reviewedCount === ordered.length

  function handleReview(entryId: string, review: Review) {
    if (!activeWarehouseId) return
    reviewItem(activeWarehouseId, entryId, review)
  }

  return (
    <div className="min-h-dvh bg-background pb-28">
      <TopBar subtitle={`${warehouse.name} · ${warehouse.city}`} roleTag="Auditor" />

      <main className="mx-auto max-w-md px-4">
        <div className="flex items-center justify-between pt-4">
          <button
            type="button"
            onClick={() => router.push('/auditor')}
            className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            Bodegas
          </button>
          <span className="rounded-full bg-muted px-3 py-1 font-display text-xs font-bold text-muted-foreground">
            {reviewedCount} de {ordered.length}
          </span>
        </div>

        <ProgressBar value={pct} className="mt-3" />
        <p className="mt-2 text-xs text-muted-foreground">
          {allReviewed ? 'Todos los conteos verificados.' : `${reviewedCount} de ${ordered.length} verificados`}
        </p>

        {/* Novedades por revisar */}
        <section className="mt-5">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-warning-soft">
              <AlertTriangle className="h-4 w-4 text-warning-foreground" />
            </span>
            <h2 className="font-display text-base font-extrabold text-foreground">
              Novedades por revisar
            </h2>
            <span className="ml-auto rounded-full bg-warning-soft px-2 py-0.5 font-display text-xs font-bold text-warning-foreground">
              {flaggedReviewed}/{flagged.length}
            </span>
          </div>

          {flagged.length === 0 ? (
            <div className="mt-3 flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
              <p className="text-sm text-muted-foreground">
                Este conteo no tiene novedades. Puedes revisar los conteos abajo.
              </p>
            </div>
          ) : (
            <ul className="mt-3 space-y-3">
              {flagged.map((entry) => (
                <li key={entry.id}>
                  <ReviewCard
                    entry={entry}
                    review={reviews[entry.id]}
                    defaultOpen={entry.id === firstPendingFlaggedId}
                    onReview={(r) => handleReview(entry.id, r)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Conteos sin novedad (desplegable) */}
        {normal.length > 0 && (
          <section className="mt-6">
            <button
              type="button"
              onClick={() => setShowNormal((v) => !v)}
              className="flex w-full items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-expanded={showNormal}
            >
              <span className="grid h-7 w-7 place-items-center rounded-full bg-success-soft">
                <CheckCircle2 className="h-4 w-4 text-success" />
              </span>
              <div className="min-w-0">
                <p className="font-display text-base font-extrabold text-foreground">
                  Conteos sin novedad
                </p>
                <p className="text-xs text-muted-foreground">
                  {normal.filter((e) => reviews[e.id]).length}/{normal.length} revisados · opcional
                </p>
              </div>
              <ChevronDown
                className={cn(
                  'ml-auto h-5 w-5 shrink-0 text-muted-foreground transition-transform',
                  showNormal && 'rotate-180',
                )}
              />
            </button>

            {showNormal && (
              <ul className="mt-3 space-y-3">
                {normal.map((entry) => (
                  <li key={entry.id}>
                    <ReviewCard
                      entry={entry}
                      review={reviews[entry.id]}
                      onReview={(r) => handleReview(entry.id, r)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </main>

      {/* CTA fija */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 backdrop-blur">
        <div className="mx-auto max-w-md px-4 py-3">
          <Button
            variant="primary"
            size="block"
            onClick={() => router.push('/auditor/reporte')}
          >
            <FileCheck2 className="h-[18px] w-[18px]" />
            {allReviewed ? 'Ver reporte final' : 'Ir al reporte'}
          </Button>
        </div>
      </div>
    </div>
  )
}
