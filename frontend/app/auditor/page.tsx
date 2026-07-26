'use client'

import { AlertTriangle, ChevronRight, Loader2, Search, Warehouse as WarehouseIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'

import { RequireRole } from '@/components/require-role'
import { TextField } from '@/components/text-field'
import { TopBar } from '@/components/top-bar'
import * as api from '@/lib/api'
import { normalizeName } from '@/lib/inventory'
import { usePresencia } from '@/lib/presencia'
import { useCountStore } from '@/lib/store'

export default function AuditorHomePage() {
  return (
    <RequireRole role="auditor">
      <BodegasDelAuditor />
    </RequireRole>
  )
}

/**
 * Las bodegas del Auditor, con lo que tiene por resolver en cada una.
 *
 * El número sale del SERVIDOR. La versión anterior filtraba por
 * `warehouses[id].submitted`, que es la cola local del operario —sus conteos, en
 * su teléfono—, así que un Auditor entrando desde otro equipo veía siempre
 * "sin conteos por verificar". Parecía funcionar únicamente si la misma persona
 * hacía los dos papeles en el mismo navegador, que es como se probó.
 */
function BodegasDelAuditor() {
  const router = useRouter()
  const { session, warehouses_disponibles, selectWarehouse } = useCountStore()
  const [query, setQuery] = useState('')
  const [conteo, setConteo] = useState<Record<string, number> | null>(null)

  // El Auditor no cuenta, así que no se anuncia como presente; pero sí le sirve
  // ver quién está contando: entrar a auditar una bodega con gente dentro
  // significa que van a llegar más rondas.
  const presencia = usePresencia(null)

  useEffect(() => {
    if (warehouses_disponibles.length === 0) return
    let vigente = true

    // Una consulta por bodega. Son ocho: un endpoint agregado ahorraría siete
    // viajes de milisegundos y añadiría una ruta más que mantener. Cuando el
    // cliente mapee sus 48 bodegas, se agrega.
    void Promise.all(
      warehouses_disponibles.map((w) =>
        api
          .pendientesDeAuditoria(w.id)
          .then((items) => [w.id, items.length] as const)
          // Una bodega que falla se muestra sin número; no tumba la lista.
          .catch(() => [w.id, -1] as const),
      ),
    ).then((pares) => {
      if (vigente) setConteo(Object.fromEntries(pares))
    })

    return () => {
      vigente = false
    }
  }, [warehouses_disponibles])

  const results = useMemo(() => {
    const q = normalizeName(query)
    const lista = q
      ? warehouses_disponibles.filter((w) => normalizeName(w.name).includes(q))
      : warehouses_disponibles
    // Primero donde hay trabajo. Un Auditor abre esta pantalla para saber qué le
    // toca, no para leer un directorio de bodegas en orden alfabético.
    return [...lista].sort((a, b) => (conteo?.[b.id] ?? 0) - (conteo?.[a.id] ?? 0))
  }, [query, warehouses_disponibles, conteo])

  const totalPendiente = conteo
    ? Object.values(conteo).reduce((n, v) => n + Math.max(0, v), 0)
    : null

  function abrir(id: string, destino: 'verificar' | 'reporte') {
    selectWarehouse(id)
    router.push(`/auditor/${destino}`)
  }

  return (
    <div className="min-h-dvh bg-background pb-10">
      <TopBar subtitle="Verificación de conteos" roleTag="Auditor" />

      <main className="mx-auto max-w-md px-4">
        <section className="mt-4 rounded-2xl border border-border bg-card p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Casos por resolver</p>
          <p className="font-display text-3xl font-extrabold leading-none text-primary">
            {totalPendiente === null ? (
              <Loader2 className="mt-1 h-7 w-7 animate-spin text-muted-foreground" />
            ) : (
              totalPendiente.toLocaleString('es-CO')
            )}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {session?.name ? `${session.name} · ` : ''}
            {warehouses_disponibles.length}{' '}
            {warehouses_disponibles.length === 1 ? 'bodega asignada' : 'bodegas asignadas'}
          </p>
        </section>

        <div className="my-4">
          <TextField
            label="Buscar bodega"
            placeholder="Nombre de la bodega"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            icon={<Search className="h-4 w-4" />}
            autoComplete="off"
          />
        </div>

        <ul className="space-y-2" aria-label="Bodegas asignadas">
          {results.map((w) => {
            const n = conteo?.[w.id]
            const contando = (presencia[w.id]?.presentes ?? []).length
            const rondas = presencia[w.id]?.rondasCerradas ?? 0
            return (
              <li key={w.id}>
                <button
                  type="button"
                  // Sin casos pendientes, lo que toca es cerrar; con casos, hay
                  // que resolverlos antes. Se lleva directo a lo que sigue.
                  onClick={() => abrir(w.id, n === 0 ? 'reporte' : 'verificar')}
                  className="flex w-full items-center gap-3 rounded-xl border-2 border-border bg-card p-3 text-left transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
                    <WarehouseIcon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-foreground">{w.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {n === undefined
                        ? 'Consultando…'
                        : n < 0
                          ? 'No se pudo consultar'
                          : n === 0
                            ? 'Sin casos pendientes'
                            : `${n} ${n === 1 ? 'caso' : 'casos'} por resolver`}
                      {rondas > 0 && ` · ${rondas} ${rondas === 1 ? 'conteo' : 'conteos'}`}
                      {contando > 0 && ` · ${contando} contando ahora`}
                    </p>
                  </div>
                  {n !== undefined && n > 0 ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning-soft px-2 py-1 text-[11px] font-bold text-warning-foreground">
                      <AlertTriangle className="h-3 w-3" />
                      {n}
                    </span>
                  ) : (
                    <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                  )}
                </button>
              </li>
            )
          })}
        </ul>

        {warehouses_disponibles.length === 0 && (
          <p className="mt-8 text-center text-sm text-muted-foreground">
            No tienes bodegas asignadas.
          </p>
        )}
      </main>
    </div>
  )
}
