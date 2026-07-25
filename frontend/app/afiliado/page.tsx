'use client'

import { CheckCircle2, ChevronRight, MapPin, Search, Warehouse as WarehouseIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { RequireRole } from '@/components/require-role'
import { TextField } from '@/components/text-field'
import { TopBar } from '@/components/top-bar'
import { WAREHOUSES } from '@/lib/data'
import { normalizeName } from '@/lib/inventory'
import { useCountStore } from '@/lib/store'
import { cn } from '@/lib/utils'

export default function AfiliadoWarehousePage() {
  return (
    <RequireRole role="afiliado">
      <SelectWarehouse />
    </RequireRole>
  )
}

function SelectWarehouse() {
  const router = useRouter()
  const { session, selectWarehouse, warehouses } = useCountStore()
  const [query, setQuery] = useState('')

  const results = useMemo(() => {
    const q = normalizeName(query)
    if (!q) return WAREHOUSES
    return WAREHOUSES.filter((w) =>
      normalizeName(`${w.name} ${w.city} ${w.zone} ${w.id}`).includes(q),
    )
  }, [query])

  function choose(id: string) {
    selectWarehouse(id)
    router.push('/afiliado/conteo')
  }

  return (
    <div className="min-h-dvh bg-background pb-10">
      <TopBar roleTag="Afiliado" />

      <main className="mx-auto max-w-md px-4">
        <section className="mt-4">
          <p className="text-sm text-muted-foreground">Hola, {session?.name.split(' ')[0]}</p>
          <h1 className="text-balance font-display text-2xl font-extrabold text-foreground">
            Selecciona la bodega a contar
          </h1>
          <p className="mt-1 text-pretty text-sm text-muted-foreground">
            Cada bodega tiene su propia ruta. Elige una y empieza a nombrar los productos por voz.
          </p>
        </section>

        {/* Filtro por teclado */}
        <div className="sticky top-14 z-10 -mx-4 mt-4 bg-background/95 px-4 pb-2 pt-2 backdrop-blur">
          <TextField
            label="Buscar bodega"
            placeholder="Nombre, ciudad o código…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            icon={<Search className="h-4 w-4" />}
            autoComplete="off"
            enterKeyHint="search"
          />
        </div>

        {/* Lista de bodegas */}
        <ul className="space-y-2" aria-label="Bodegas disponibles">
          {results.map((w) => {
            const wh = warehouses[w.id]
            const inProgress = wh && wh.entries.length > 0 && !wh.submitted
            const submitted = wh?.submitted
            return (
              <li key={w.id}>
                <button
                  type="button"
                  onClick={() => choose(w.id)}
                  className="flex w-full items-center gap-3 rounded-xl border-2 border-border bg-card p-3 text-left transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
                    <WarehouseIcon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-foreground">{w.name}</p>
                    <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3 shrink-0" />
                      {w.city} · {w.id}
                    </p>
                  </div>
                  {submitted ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success-soft px-2 py-1 text-[11px] font-semibold text-success">
                      <CheckCircle2 className="h-3 w-3" /> Enviada
                    </span>
                  ) : inProgress ? (
                    <span className="shrink-0 rounded-full bg-warning-soft px-2 py-1 text-[11px] font-semibold text-warning-foreground">
                      {wh!.entries.length} en curso
                    </span>
                  ) : (
                    <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                  )}
                </button>
              </li>
            )
          })}
          {results.length === 0 && (
            <li
              className={cn(
                'rounded-xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground',
              )}
            >
              No encontramos bodegas para “{query}”.
            </li>
          )}
        </ul>
      </main>
    </div>
  )
}
