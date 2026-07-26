'use client'

import { AlertTriangle, CheckCircle2, ChevronRight, History, Loader2, MapPin, Search, Users, Warehouse as WarehouseIcon } from 'lucide-react'
import { describir, type Warehouse } from '@/lib/data'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { RequireRole } from '@/components/require-role'
import { TextField } from '@/components/text-field'
import { TopBar } from '@/components/top-bar'
import { normalizeName } from '@/lib/inventory'
import { usePresencia } from '@/lib/presencia'
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
  const { session, selectWarehouse, warehouses, warehouses_disponibles, activeWarehouseId, error } =
    useCountStore()
  const [query, setQuery] = useState('')
  /** La bodega cuya ronda se está abriendo. Bloquea la lista mientras tanto. */
  const [abriendo, setAbriendo] = useState<string | null>(null)

  // La vista compartida del equipo. Trae quién está contando y cuántas rondas
  // lleva cada bodega — nunca cantidades: eso acabaría con el conteo ciego.
  const presencia = usePresencia(
    activeWarehouseId && session
      ? { bodegaId: activeWarehouseId, nombre: session.name }
      : null,
  )

  const results = useMemo(() => {
    const q = normalizeName(query)
    if (!q) return warehouses_disponibles
    return warehouses_disponibles.filter((w: Warehouse) =>
      normalizeName(`${w.name} ${w.city ?? ''} ${w.zone ?? ''}`).includes(q),
    )
  }, [query])

  const [aviso, setAviso] = useState<{ id: string; otros: string[] } | null>(null)

  function choose(id: string) {
    const otros = (presencia[id]?.presentes ?? [])
      .filter((x) => x.usuarioId !== session?.username)
      .map((x) => x.nombre)

    // Se AVISA, no se impide. Que dos personas cuenten la misma bodega es el
    // mecanismo —cada una en su ronda, sin pisarse, y la coincidencia entre
    // conteos independientes es lo que sostiene la conciliación (D5)—. Lo que
    // no debe pasar es que se enteren cuando ya está hecho.
    if (otros.length > 0) {
      setAviso({ id, otros })
      return
    }
    void entrar(id)
  }

  /**
   * Se navega al conteo SOLO si la ronda abrió.
   *
   * Antes se empujaba sin esperar: si `abrirRonda` fallaba —red, sesión, una
   * bodega que ya no está asignada— la pantalla de conteo se quedaba en
   * "Abriendo la ronda…" para siempre, sin error y sin salida, y el operario
   * no tenía forma de saber que no estaba contando nada.
   */
  async function entrar(id: string) {
    setAviso(null)
    setAbriendo(id)
    const abierta = await selectWarehouse(id)
    setAbriendo(null)
    // Si no abrió, el motivo ya está en `error` y se pinta arriba de la lista.
    if (abierta) router.push('/afiliado/conteo')
  }

  return (
    <div className="min-h-dvh bg-background pb-10">
      <TopBar roleTag="Afiliado" />

      {aviso && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div
            role="alertdialog"
            aria-modal="true"
            className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-xl"
          >
            <p className="flex items-start gap-2 font-display text-base font-bold text-foreground">
              <Users className="mt-0.5 h-5 w-5 shrink-0 text-warning-foreground" />
              {aviso.otros.length === 1
                ? `${aviso.otros[0]} está contando en esta bodega`
                : `${aviso.otros.length} operarios están contando en esta bodega`}
            </p>
            {/* Se dice que hay alguien; NUNCA qué ha contado. Un operario que
                supiera el conteo del otro dejaría de contar a ciegas. */}
            <p className="mt-2 text-sm text-muted-foreground">
              Tu conteo es independiente del suyo y no se mezcla con el de nadie. Sigue si es lo que
              acordaron; si no, elige otra bodega.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => void entrar(aviso.id)}
                className="h-12 rounded-xl bg-primary font-display text-sm font-bold text-primary-foreground"
              >
                Entrar de todos modos
              </button>
              <button
                type="button"
                onClick={() => setAviso(null)}
                className="h-12 rounded-xl border-2 border-input bg-card font-display text-sm font-bold text-foreground"
              >
                Elegir otra bodega
              </button>
            </div>
          </div>
        </div>
      )}

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

        {/* Lo que falló, con palabras. La tienda lo guardaba en `error` y
            ninguna pantalla lo pintaba: una ronda que no abre, un catálogo que
            no baja o el disco lleno se veían como que no pasaba nada. */}
        {error && (
          <p
            role="alert"
            className="mb-3 flex items-start gap-1.5 rounded-lg bg-destructive/10 p-2.5 text-sm text-destructive"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        )}

        {/* Lista de bodegas */}
        <ul className="space-y-2" aria-label="Bodegas disponibles">
          {results.map((w) => {
            const wh = warehouses[w.id]
            const inProgress = wh && wh.entries.length > 0 && !wh.submitted
            const submitted = wh?.submitted
            const p = presencia[w.id]
            // Los demás, no uno mismo: verse a sí mismo en la lista de "otros
            // contando aquí" hace dudar de si el sistema entendió algo.
            const otros = (p?.presentes ?? []).filter((x) => x.usuarioId !== session?.username)
            const rondas = (p?.rondasCerradas ?? 0) + (p?.rondasAbiertas ?? 0)
            return (
              <li key={w.id}>
                <button
                  type="button"
                  onClick={() => choose(w.id)}
                  disabled={abriendo !== null}
                  className="flex w-full items-center gap-3 rounded-xl border-2 border-border bg-card p-3 text-left transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
                    <WarehouseIcon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-foreground">{w.name}</p>
                    <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3 shrink-0" />
                      {describir(w)}
                    </p>

                    {/* Coordinación, no resultado. Dice cuántos y quiénes; el
                        avance de cada uno sigue siendo suyo hasta que cierre. */}
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
                      {otros.length > 0 && (
                        <span className="inline-flex items-center gap-1 font-semibold text-warning-foreground">
                          <Users className="h-3 w-3 shrink-0" />
                          {otros.length === 1
                            ? `${otros[0]!.nombre} está contando aquí`
                            : `${otros.length} operarios contando aquí`}
                        </span>
                      )}
                      {rondas > 0 && (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <History className="h-3 w-3 shrink-0" />
                          {p!.rondasCerradas} {p!.rondasCerradas === 1 ? 'conteo' : 'conteos'}
                          {p!.rondasAbiertas > 0 && ` · ${p!.rondasAbiertas} sin cerrar`}
                        </span>
                      )}
                    </p>
                  </div>
                  {abriendo === w.id ? (
                    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      Abriendo…
                    </span>
                  ) : submitted ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success-soft px-2 py-1 text-[11px] font-semibold text-success">
                      <CheckCircle2 className="h-3 w-3" /> Enviada
                    </span>
                  ) : inProgress ? (
                    <span className="shrink-0 rounded-full bg-warning-soft px-2 py-1 text-[11px] font-semibold tabular-nums text-warning-foreground">
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
