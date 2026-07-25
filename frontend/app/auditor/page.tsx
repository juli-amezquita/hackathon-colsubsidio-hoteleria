'use client'

import { AlertTriangle, CheckCircle2, ChevronRight, Inbox, MapPin } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo } from 'react'
import { ProgressBar } from '@/components/progress-bar'
import { RequireRole } from '@/components/require-role'
import { TopBar } from '@/components/top-bar'
import { WAREHOUSES } from '@/lib/data'
import { progress } from '@/lib/inventory'
import { useCountStore } from '@/lib/store'
import { cn } from '@/lib/utils'

export default function AuditorHomePage() {
  return (
    <RequireRole role="auditor">
      <AuditorHome />
    </RequireRole>
  )
}

function AuditorHome() {
  const router = useRouter()
  const { warehouses, selectWarehouse, session } = useCountStore()

  const submitted = useMemo(
    () =>
      WAREHOUSES.map((w) => ({ warehouse: w, count: warehouses[w.id] })).filter(
        (x) => x.count?.submitted && x.count.entries.length > 0,
      ),
    [warehouses],
  )

  function open(id: string, done: boolean) {
    selectWarehouse(id)
    router.push(done ? '/auditor/reporte' : '/auditor/verificar')
  }

  if (submitted.length === 0) {
    return (
      <div className="min-h-dvh bg-background">
        <TopBar subtitle="Verificación de conteos" roleTag="Auditor" />
        <main className="mx-auto flex max-w-md flex-col items-center px-4 pt-16 text-center">
          <span className="grid h-20 w-20 place-items-center rounded-full bg-muted">
            <Inbox className="h-9 w-9 text-muted-foreground" />
          </span>
          <h1 className="mt-5 font-display text-xl font-extrabold text-foreground">
            Sin conteos por verificar
          </h1>
          <p className="mt-2 text-pretty text-sm text-muted-foreground">
            Cuando un afiliado envíe el conteo de una bodega, aparecerá aquí para que lo verifiques.
          </p>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-background pb-10">
      <TopBar subtitle="Verificación de conteos" roleTag="Auditor" />

      <main className="mx-auto max-w-md px-4">
        <section className="mt-4">
          <p className="text-sm text-muted-foreground">Hola, {session?.name.split(' ')[0]}</p>
          <h1 className="font-display text-2xl font-extrabold text-foreground">
            Conteos recibidos
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {submitted.length} bodega{submitted.length > 1 ? 's' : ''} enviada
            {submitted.length > 1 ? 's' : ''} para verificar.
          </p>
        </section>

        <ul className="mt-4 space-y-3">
          {submitted.map(({ warehouse, count }) => {
            const entries = count!.entries
            const { total, flagged } = progress(entries)
            const reviewed = entries.filter((e) => count!.reviews[e.id]).length
            const pct = total ? Math.round((reviewed / total) * 100) : 0
            const done = reviewed === total
            return (
              <li key={warehouse.id}>
                <button
                  type="button"
                  onClick={() => open(warehouse.id, done)}
                  className="w-full rounded-2xl border-2 border-border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-display text-base font-bold text-foreground">
                        {warehouse.name}
                      </p>
                      <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3 shrink-0" />
                        {warehouse.city} · {warehouse.id}
                      </p>
                    </div>
                    {done ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success-soft px-2 py-1 text-[11px] font-semibold text-success">
                        <CheckCircle2 className="h-3 w-3" /> Verificada
                      </span>
                    ) : (
                      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                    )}
                  </div>

                  <ProgressBar value={pct} className="mt-3" />
                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {reviewed} de {total} verificados
                    </span>
                    {flagged > 0 && (
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 font-semibold text-warning-foreground',
                        )}
                      >
                        <AlertTriangle className="h-3 w-3" /> {flagged} por validar
                      </span>
                    )}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      </main>
    </div>
  )
}
