'use client'

import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeftRight,
  Check,
  ChevronLeft,
  Copy,
  FileSpreadsheet,
  RotateCcw,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { RequireRole } from '@/components/require-role'
import { TopBar } from '@/components/top-bar'
import { Button } from '@/components/ui-button'
import { getWarehouse } from '@/lib/data'
import { buildCsv, buildReportRows, downloadCsv } from '@/lib/export'
import { formatUnit } from '@/lib/inventory'
import { useCountStore } from '@/lib/store'
import { cn } from '@/lib/utils'

export default function AuditorReportPage() {
  return (
    <RequireRole role="auditor">
      <AuditorReport />
    </RequireRole>
  )
}

function AuditorReport() {
  const router = useRouter()
  const { ready, activeWarehouseId, active, clearWarehouse } = useCountStore()
  const [downloaded, setDownloaded] = useState(false)

  const warehouse = getWarehouse(activeWarehouseId)
  const rows = useMemo(
    () => (active ? buildReportRows(active.entries, active.reviews) : []),
    [active],
  )

  useEffect(() => {
    if (ready && (!activeWarehouseId || !active || active.entries.length === 0 || !active.submitted)) {
      router.replace('/auditor')
    }
  }, [ready, activeWarehouseId, active, router])

  if (!warehouse || rows.length === 0) return null

  const approved = rows.filter((r) => r.status === 'aprobado').length
  const corrected = rows.filter((r) => r.status === 'corregido').length
  const pending = rows.filter((r) => r.status === 'pendiente').length
  const totalDiff = rows.reduce((sum, r) => sum + Math.abs(r.difference), 0)

  function handleExport() {
    if (!warehouse) return
    const csv = buildCsv(rows, warehouse)
    const stamp = new Date().toISOString().slice(0, 10)
    downloadCsv(`conteo-${warehouse.id}-${stamp}.csv`, csv)
    setDownloaded(true)
  }

  function handleReset() {
    if (activeWarehouseId) clearWarehouse(activeWarehouseId)
    router.push('/auditor')
  }

  return (
    <div className="min-h-dvh bg-background pb-40">
      <TopBar subtitle={`${warehouse.name} · ${warehouse.city}`} roleTag="Auditor" />

      <main className="mx-auto max-w-md px-4">
        <button
          type="button"
          onClick={() => router.push('/auditor')}
          className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Bodegas
        </button>

        <section className="mt-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
          <span
            className={cn(
              'grid h-12 w-12 place-items-center rounded-xl',
              pending === 0 ? 'bg-success-soft' : 'bg-warning-soft',
            )}
          >
            <Check className={cn('h-6 w-6', pending === 0 ? 'text-success' : 'text-warning-foreground')} />
          </span>
          <h1 className="mt-3 font-display text-xl font-extrabold text-foreground">
            {pending === 0 ? 'Verificación completada' : 'Reporte en progreso'}
          </h1>
          <p className="mt-1 text-pretty text-sm text-muted-foreground">
            {pending === 0
              ? 'Todos los ítems fueron revisados. Exporta el reporte final en CSV para el sistema de inventario.'
              : `Faltan ${pending} ítem${pending > 1 ? 's' : ''} por verificar. Puedes exportar un avance parcial.`}
          </p>

          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-success-soft p-3">
              <p className="font-display text-xl font-extrabold text-success">{approved}</p>
              <p className="text-[11px] text-muted-foreground">Aprobados</p>
            </div>
            <div className="rounded-xl bg-primary-soft p-3">
              <p className="font-display text-xl font-extrabold text-primary">{corrected}</p>
              <p className="text-[11px] text-muted-foreground">Corregidos</p>
            </div>
            <div className="rounded-xl bg-muted p-3">
              <p className="font-display text-xl font-extrabold text-foreground">{totalDiff}</p>
              <p className="text-[11px] text-muted-foreground">Dif. total</p>
            </div>
          </div>
        </section>

        <h2 className="mb-2 mt-5 font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Detalle del reporte
        </h2>
        <ol className="space-y-2">
          {rows.map((r) => {
            const changed = r.difference !== 0
            return (
              <li key={r.order} className="rounded-xl border border-border bg-card p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-foreground">
                      <span className="mr-1 text-muted-foreground">{r.order}.</span>
                      {r.name}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold',
                      r.status === 'aprobado'
                        ? 'bg-success-soft text-success'
                        : r.status === 'corregido'
                          ? 'bg-primary-soft text-primary'
                          : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {r.status === 'aprobado' ? 'Aprobado' : r.status === 'corregido' ? 'Corregido' : 'Pendiente'}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span className="text-muted-foreground">
                    Afiliado:{' '}
                    <strong className="text-foreground">
                      {formatUnit(r.affiliateQty, r.affiliateUnit)}
                    </strong>
                  </span>
                  {changed && (
                    <span className="inline-flex items-center gap-1 text-primary">
                      <ArrowLeftRight className="h-3 w-3" />
                      Auditor: <strong>{formatUnit(r.auditorQty, r.auditorUnit)}</strong>
                    </span>
                  )}
                  {r.wasAnomaly && (
                    <span className="inline-flex items-center gap-0.5 rounded bg-warning-soft px-1.5 py-0.5 text-warning-foreground">
                      <AlertTriangle className="h-3 w-3" /> inusual
                    </span>
                  )}
                  {r.wasDuplicate && (
                    <span className="inline-flex items-center gap-0.5 rounded bg-warning-soft px-1.5 py-0.5 text-warning-foreground">
                      <Copy className="h-3 w-3" /> repetido
                    </span>
                  )}
                </div>
                {r.note && (
                  <p className="mt-2 border-t border-border pt-2 text-xs italic text-muted-foreground">
                    {r.note}
                  </p>
                )}
              </li>
            )
          })}
        </ol>

        <div className="mt-5 flex items-center gap-2 rounded-xl border border-border bg-muted p-3 text-xs text-muted-foreground">
          <FileSpreadsheet className="h-4 w-4 shrink-0" />
          <span>
            El archivo CSV usa punto y coma (;) como separador y codificación UTF-8, compatible con
            Excel en español.
          </span>
        </div>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-md flex-col gap-2 px-4 py-3">
          <Button size="block" variant={downloaded ? 'success' : 'primary'} onClick={handleExport}>
            {downloaded ? (
              <>
                <Check className="h-[18px] w-[18px]" />
                Descargado — exportar de nuevo
              </>
            ) : (
              <>
                <ArrowDownToLine className="h-[18px] w-[18px]" />
                Exportar reporte CSV
              </>
            )}
          </Button>
          {downloaded && (
            <Button size="block" variant="ghost" onClick={handleReset}>
              <RotateCcw className="h-[18px] w-[18px]" />
              Cerrar y archivar esta bodega
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
