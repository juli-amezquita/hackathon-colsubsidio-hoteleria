'use client'

import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  Eye,
  Loader2,
  PackageSearch,
  Scale,
  Users,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { QuantityField } from '@/components/quantity-field'
import { RequireRole } from '@/components/require-role'
import { TopBar } from '@/components/top-bar'
import { Button } from '@/components/ui-button'
import * as api from '@/lib/api'
import { leerMotivo, useCodigosRazon, usePendientes, type Pendiente } from '@/lib/auditoria'
import { useCountStore } from '@/lib/store'
import { cn } from '@/lib/utils'

export default function AuditorVerifyPage() {
  return (
    <RequireRole role="auditor">
      <Verificar />
    </RequireRole>
  )
}

/**
 * La cola de auditoría: los casos que el sistema no pudo cerrar solo.
 *
 * Cada caso trae lo que ninguna otra pantalla muestra: **el saldo esperado**. El
 * Auditor es el único rol que puede verlo (FR-1.18), y por eso esta ruta
 * devuelve 403 a un Operador aunque su sesión sea válida.
 *
 * Lo que hace aquí no es "aprobar": es **recontar con una causa**. Su cifra
 * prevalece sobre la de los operarios (FR-4.5), y sin causa del catálogo
 * controlado no se cierra nada (R4, FR-4.4) — una discrepancia sin explicación
 * es un número que nadie puede defender ante el sistema central.
 */
function Verificar() {
  const router = useRouter()
  const { ready, activeWarehouseId, getWarehouse } = useCountStore()
  const warehouse = getWarehouse(activeWarehouseId)
  const { items, error, recargar } = usePendientes(activeWarehouseId)
  const [abierto, setAbierto] = useState<Pendiente | null>(null)

  useEffect(() => {
    if (ready && !activeWarehouseId) router.replace('/auditor')
  }, [ready, activeWarehouseId, router])

  if (!warehouse) return null

  return (
    <div className="min-h-dvh bg-background pb-10">
      <TopBar
        title={warehouse.name}
        subtitle="Casos por resolver"
        backHref="/auditor"
        roleTag="Auditor"
      />

      <main className="mx-auto max-w-md px-4">
        {error && (
          <p className="mt-4 flex items-start gap-1.5 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        )}

        {items === null && !error && (
          <p className="mt-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando la cola…
          </p>
        )}

        {items?.length === 0 && (
          <div className="mt-14 text-center">
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-success-soft">
              <CheckCircle2 className="h-8 w-8 text-success" />
            </span>
            <p className="mt-4 font-display text-lg font-extrabold text-foreground">
              Nada por resolver
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Todo lo contado en esta bodega cuadró dentro de la tolerancia.
            </p>
          </div>
        )}

        {items && items.length > 0 && (
          <>
            <p className="mt-4 text-sm text-muted-foreground">
              {items.length} {items.length === 1 ? 'caso' : 'casos'}. Tu cifra prevalece sobre la de
              los operarios y necesita una causa.
            </p>

            <ul className="mt-3 space-y-2">
              {items.map((p) => (
                <li key={p.articuloId ?? p.fantasmaId}>
                  <button
                    type="button"
                    onClick={() => setAbierto(p)}
                    className="flex w-full items-center gap-3 rounded-xl border-2 border-border bg-card p-3 text-left transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span
                      className={cn(
                        'grid h-9 w-9 shrink-0 place-items-center rounded-lg',
                        p.fantasmaId
                          ? 'bg-warning-soft text-warning-foreground'
                          : 'bg-primary-soft text-primary',
                      )}
                    >
                      {p.fantasmaId ? (
                        <PackageSearch className="h-4 w-4" />
                      ) : (
                        <Scale className="h-4 w-4" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-foreground">{p.nombre}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {leerMotivo(p.motivo)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>

      {abierto && activeWarehouseId && (
        <Caso
          bodegaId={activeWarehouseId}
          pendiente={abierto}
          onCerrar={() => setAbierto(null)}
          onResuelto={() => {
            setAbierto(null)
            void recargar()
          }}
        />
      )}
    </div>
  )
}

/** El expediente de un caso: todo lo que hace falta para decidir, y nada más. */
function Caso({
  bodegaId,
  pendiente,
  onCerrar,
  onResuelto,
}: {
  bodegaId: string
  pendiente: Pendiente
  onCerrar: () => void
  onResuelto: () => void
}) {
  const codigos = useCodigosRazon()
  const [caso, setCaso] = useState<api.CasoAuditoria | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cantidad, setCantidad] = useState(0)
  const [razon, setRazon] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    if (!pendiente.articuloId) return
    api
      .casoDeAuditoria(bodegaId, pendiente.articuloId)
      .then(setCaso)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'No se pudo abrir el caso.'))
  }, [bodegaId, pendiente.articuloId])

  async function resolver() {
    if (!caso || !razon || cantidad <= 0) return
    setEnviando(true)
    setError(null)
    try {
      await api.recontar(bodegaId, caso.articulo.articuloId, {
        cantidad,
        unidadId: caso.articulo.unidadId,
        codigoRazonId: razon,
      })
      onResuelto()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar el reconteo.')
      setEnviando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <TopBar title={pendiente.nombre} subtitle={leerMotivo(pendiente.motivo)} roleTag="Auditor" />
      <button
        type="button"
        onClick={onCerrar}
        className="absolute left-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-full bg-card/80"
        aria-label="Volver a la lista"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>

      <div className="flex-1 overflow-y-auto pb-6">
        <div className="mx-auto max-w-md px-4">
          {!caso && !error && (
            <p className="mt-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Abriendo el caso…
            </p>
          )}

          {error && (
            <p className="mt-4 flex items-start gap-1.5 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </p>
          )}

          {/* Un hallazgo no tiene saldo esperado contra el que compararse: no
              existe en el catálogo. Se muestra lo que se observó y ya. */}
          {pendiente.fantasmaId && !caso && !error && (
            <section className="mt-4 rounded-2xl border-2 border-warning-border bg-warning/10 p-4">
              <p className="flex items-center gap-1.5 font-display text-sm font-bold text-warning-foreground">
                <PackageSearch className="h-4 w-4" />
                Hallazgo sin catálogo
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Un operario encontró <strong>{pendiente.nombre}</strong> en el estante y no está en
                el catálogo de esta bodega. No hay saldo esperado con el que compararlo.
              </p>
            </section>
          )}

          {caso && (
            <>
              {/* El saldo esperado: lo único de todo el sistema que solo este
                  rol puede ver. Por eso se marca explícitamente. */}
              <section className="mt-4 rounded-2xl border-2 border-primary/30 bg-primary-soft/40 p-4">
                <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-primary">
                  <Eye className="h-3.5 w-3.5" />
                  Solo tú ves esto
                </p>
                <p className="mt-1 font-display text-3xl font-extrabold leading-none text-foreground">
                  {caso.saldoEsperado ?? '—'}{' '}
                  <span className="text-base font-bold text-muted-foreground">
                    {caso.articulo.unidad}
                  </span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Saldo esperado por el sistema central
                  {caso.articulo.codigo ? ` · código ${caso.articulo.codigo}` : ''}
                </p>
              </section>

              {/* Lo que dijo cada ronda. No una cifra ya reconciliada: el
                  Auditor recibe el histórico completo y decide él. */}
              <section className="mt-4">
                <h2 className="flex items-center gap-1.5 font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">
                  <Users className="h-4 w-4" />
                  Lo que contó cada ronda
                </h2>
                {caso.rondas.length === 0 ? (
                  <p className="mt-2 rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">
                    Ninguna ronda registró este artículo.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {caso.rondas.map((r) => (
                      <li
                        key={r.rondaId}
                        className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card p-3"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-foreground">
                            {r.operador}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {r.estado === 'no_contado'
                              ? 'No lo contó'
                              : r.estado === 'contado_en_cero'
                                ? 'Contado en cero'
                                : `${r.cantidad ?? '—'} ${caso.articulo.unidad}`}
                            {r.diferencia && ` · diferencia ${r.diferencia}`}
                          </span>
                        </span>
                        {/* Una ronda contada por este mismo Auditor rompe su
                            independencia. Se marca para que lo sepa antes de
                            decidir, no después. */}
                        {r.contadaPorEsteAuditor && (
                          <span className="shrink-0 rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-bold text-warning-foreground">
                            La contaste tú
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* El árbitro ORDENA la evidencia; no dice quién tiene razón. Por
                  eso se presenta como relato y preguntas, nunca como una cifra
                  recomendada — eso sería decidir por el Auditor. */}
              {caso.sintesis && (
                <section className="mt-4 rounded-2xl border border-border bg-muted/40 p-4">
                  <h2 className="font-display text-sm font-bold text-foreground">
                    Ordenando la evidencia
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">{caso.sintesis.relato}</p>
                  {caso.sintesis.preguntas.length > 0 && (
                    <ul className="mt-2 list-disc space-y-0.5 pl-4 text-sm text-muted-foreground">
                      {caso.sintesis.preguntas.map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-2 text-[11px] italic text-muted-foreground">
                    Ordena lo que hay. La decisión es tuya.
                  </p>
                </section>
              )}

              {/* Reconteos anteriores: si otro Auditor ya tocó este caso, se ve. */}
              {caso.reconteos.length > 0 && (
                <section className="mt-4">
                  <h2 className="font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">
                    Reconteos anteriores
                  </h2>
                  <ul className="mt-2 space-y-1.5">
                    {caso.reconteos.map((r, i) => (
                      <li key={i} className="rounded-xl border border-border bg-card p-3 text-sm">
                        <span className="font-semibold text-foreground">
                          {r.cantidad} {caso.articulo.unidad}
                        </span>{' '}
                        <span className="text-muted-foreground">
                          · {r.auditor} · {r.codigoRazon}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* El reconteo. Prevalece sobre todo lo anterior (FR-4.5). */}
              <section className="mt-4 rounded-2xl border border-border bg-card p-4 shadow-sm">
                <h2 className="font-display text-sm font-bold text-foreground">Tu reconteo</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Prevalece sobre lo que contaron los operarios.
                </p>

                <div className="mt-3">
                  <QuantityField value={cantidad} onChange={setCantidad} />
                </div>

                <p className="mb-1.5 mt-4 text-sm font-semibold text-foreground">Causa</p>
                <div className="space-y-1.5">
                  {codigos.map((c) => (
                    <label
                      key={c.id}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-xl border-2 p-2.5 text-sm transition-colors',
                        razon === c.id ? 'border-primary bg-primary-soft/40' : 'border-input bg-card',
                      )}
                    >
                      <input
                        type="radio"
                        name="causa"
                        value={c.id}
                        checked={razon === c.id}
                        onChange={() => setRazon(c.id)}
                        className="h-4 w-4 shrink-0"
                      />
                      {c.descripcion}
                    </label>
                  ))}
                </div>
                {codigos.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No se pudieron cargar las causas. Sin causa no se puede cerrar un caso.
                  </p>
                )}
              </section>
            </>
          )}
        </div>
      </div>

      {caso && (
        <div className="border-t border-border bg-card/95 backdrop-blur">
          <div className="mx-auto max-w-md px-4 py-3">
            <Button
              size="block"
              loading={enviando}
              disabled={cantidad <= 0 || !razon || enviando}
              onClick={() => void resolver()}
            >
              <CheckCircle2 className="h-[18px] w-[18px]" />
              {enviando ? 'Registrando…' : 'Registrar reconteo'}
            </Button>
            {(cantidad <= 0 || !razon) && (
              <p className="mt-2 text-center text-xs text-muted-foreground">
                {cantidad <= 0 ? 'Escribe la cantidad que contaste' : 'Elige la causa'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
