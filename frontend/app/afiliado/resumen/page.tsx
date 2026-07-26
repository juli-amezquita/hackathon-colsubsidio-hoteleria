'use client'

import { AlertTriangle, CheckCircle2, Copy, HelpCircle, Send } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { RequireRole } from '@/components/require-role'
import { TopBar } from '@/components/top-bar'
import { Button } from '@/components/ui-button'
import { getWarehouse } from '@/lib/data'
import { formatUnit, orderedEntries, progress } from '@/lib/inventory'
import { useCountStore } from '@/lib/store'
import { cn } from '@/lib/utils'

export default function ResumenPage() {
  return (
    <RequireRole role="afiliado">
      <Resumen />
    </RequireRole>
  )
}

function Resumen() {
  const router = useRouter()
  const { ready, activeWarehouseId, active, submitCount, session } = useCountStore()

  const warehouse = getWarehouse(activeWarehouseId)
  const entries = active ? orderedEntries(active.entries) : []
  const { total, anomalies, duplicates, flagged } = progress(entries)
  const submitted = active?.submitted

  useEffect(() => {
    if (ready && (!activeWarehouseId || !warehouse)) router.replace('/afiliado')
  }, [ready, activeWarehouseId, warehouse, router])

  if (!warehouse) return null

  if (submitted) {
    return (
      <div className="min-h-dvh bg-background">
        <TopBar title="Conteo enviado" subtitle={warehouse.name} roleTag="Afiliado" />
        <main className="mx-auto flex max-w-md flex-col items-center px-4 pt-10 text-center">
          <span className="grid h-20 w-20 place-items-center rounded-full bg-success-soft">
            <CheckCircle2 className="h-10 w-10 text-success" />
          </span>
          <h1 className="mt-5 font-display text-2xl font-extrabold text-foreground">
            ¡Conteo enviado!
          </h1>
          <p className="mt-2 text-pretty text-sm text-muted-foreground">
            {session?.name} envió {total} producto{total === 1 ? '' : 's'} de {warehouse.name}
            {flagged > 0 ? `, con ${flagged} por validar` : ''}. El auditor los recibirá en el mismo
            orden en que los contaste.
          </p>

          <div className="mt-6 w-full rounded-2xl border border-border bg-card p-4 text-left shadow-sm">
            <Row label="Bodega" value={`${warehouse.name} · ${warehouse.city}`} />
            <Row label="Productos contados" value={String(total)} />
            <Row label="Por validar" value={String(flagged)} />
            <Row label="Responsable" value={session?.name ?? '—'} />
          </div>

          <div className="mt-6 flex w-full flex-col gap-2">
            <Button size="block" onClick={() => router.push('/auditor')}>
              Ir a verificación del auditor
            </Button>
            <Button variant="ghost" size="block" onClick={() => router.push('/afiliado')}>
              Contar otra bodega
            </Button>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-background pb-28">
      <TopBar
        title="Resumen del conteo"
        subtitle={`${warehouse.name} · ${total} producto${total === 1 ? '' : 's'}`}
        backHref="/afiliado/conteo"
        roleTag="Afiliado"
      />

      <main className="mx-auto max-w-md px-4">
        <section className="mt-4 grid grid-cols-3 gap-2">
          <SummaryStat label="Contados" value={total} tone="primary" />
          <SummaryStat label="Sin alertas" value={total - flagged} tone="success" />
          <SummaryStat label="Por validar" value={flagged} tone="warning" />
        </section>

        {flagged > 0 && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-warning-border bg-warning-soft px-3 py-2.5 text-sm text-warning-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {flagged} producto{flagged > 1 ? 's' : ''} quedaron marcados para revisión
              {anomalies > 0 ? ` (${anomalies} con cantidad inusual` : ''}
              {anomalies > 0 && duplicates > 0 ? `, ${duplicates} repetido${duplicates > 1 ? 's' : ''})` : anomalies > 0 ? ')' : ''}
              . El auditor los verificará.
            </span>
          </div>
        )}

        <h2 className="mb-2 mt-5 font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Detalle en orden de captura
        </h2>

        <ol className="space-y-2">
          {entries.map((entry, i) => {
            const isFlagged = entry.isAnomaly || entry.isDuplicate || entry.needsReview
            return (
              <li
                key={entry.id}
                className={cn(
                  'flex items-center gap-3 rounded-xl border-2 bg-card p-3',
                  isFlagged ? 'border-warning-border' : 'border-border',
                )}
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted font-display text-xs font-bold text-muted-foreground">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-foreground">{entry.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatUnit(entry.quantity, entry.unit)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {entry.needsReview && <HelpCircle className="h-4 w-4 text-warning-foreground" aria-label="Revisar" />}
                  {entry.isAnomaly && <AlertTriangle className="h-4 w-4 text-warning-foreground" aria-label="Cantidad inusual" />}
                  {entry.isDuplicate && <Copy className="h-4 w-4 text-warning-foreground" aria-label="Repetido" />}
                  {!isFlagged && <CheckCircle2 className="h-4 w-4 text-success" aria-label="Sin alertas" />}
                </div>
              </li>
            )
          })}
        </ol>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 backdrop-blur">
        <div className="mx-auto max-w-md px-4 py-3">
          <Button size="block" onClick={() => submitCount()} disabled={total === 0}>
            <Send className="h-[18px] w-[18px]" />
            Enviar conteo al auditor
          </Button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border py-2 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold text-foreground">{value}</span>
    </div>
  )
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'primary' | 'success' | 'warning'
}) {
  return (
    <div
      className={cn(
        'rounded-xl p-3 text-center',
        tone === 'primary' && 'bg-primary-soft',
        tone === 'success' && 'bg-success-soft',
        tone === 'warning' && 'bg-warning-soft',
      )}
    >
      <p
        className={cn(
          'font-display text-2xl font-extrabold leading-none',
          tone === 'primary' && 'text-primary',
          tone === 'success' && 'text-success',
          tone === 'warning' && 'text-warning-foreground',
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">{label}</p>
    </div>
  )
}
