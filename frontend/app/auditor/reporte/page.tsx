'use client'

import { AlertTriangle, ArrowDownToLine, CheckCircle2, Eye, Loader2, Lock, Search } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'

import { RequireRole } from '@/components/require-role'
import { TextField } from '@/components/text-field'
import { TopBar } from '@/components/top-bar'
import { Button } from '@/components/ui-button'
import * as api from '@/lib/api'
import { leerMotivo } from '@/lib/auditoria'
import { normalizeName } from '@/lib/inventory'
import { useCountStore } from '@/lib/store'
import { cn } from '@/lib/utils'

export default function AuditorReportPage() {
  return (
    <RequireRole role="auditor">
      <Cierre />
    </RequireRole>
  )
}

/**
 * El consolidado de la bodega y su cierre.
 *
 * Enseña la comparación completa —lo que el sistema tenía frente a lo que la
 * gente encontró— y es el único sitio del producto donde se puede pulsar algo
 * que **mueve la tabla madre**.
 *
 * Hasta aquí ningún conteo la ha tocado: el libro solo acumula afirmaciones
 * (D8). El saldo se mueve con el aval del Auditor, en el cierre y no antes
 * (FR-7.9). Por eso el botón dice lo que hace en vez de preguntar "¿estás
 * seguro?": nadie decide mejor porque le pregunten dos veces; decide mejor si
 * sabe qué va a pasar.
 */
function Cierre() {
  const router = useRouter()
  const { ready, activeWarehouseId, getWarehouse } = useCountStore()
  const warehouse = getWarehouse(activeWarehouseId)

  const [items, setItems] = useState<api.ItemConsolidado[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [confirmando, setConfirmando] = useState(false)
  const [cerrando, setCerrando] = useState(false)
  const [cerrado, setCerrado] = useState<{ articulosActualizados: number } | null>(null)

  useEffect(() => {
    if (ready && !activeWarehouseId) router.replace('/auditor')
  }, [ready, activeWarehouseId, router])

  useEffect(() => {
    if (!activeWarehouseId) return
    api
      .consolidado(activeWarehouseId)
      .then(setItems)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : 'No se pudo cargar el consolidado.'),
      )
  }, [activeWarehouseId])

  const resumen = useMemo(
    () =>
      items
        ? {
            total: items.length,
            auditables: items.filter((i) => i.clasificacion === 'auditable').length,
            conciliados: items.filter((i) => i.clasificacion === 'conciliado').length,
          }
        : null,
    [items],
  )

  const visibles = useMemo(() => {
    if (!items) return []
    const q = normalizeName(query)
    const lista = q
      ? items.filter((i) => normalizeName(`${i.nombre} ${i.codigo ?? ''}`).includes(q))
      : items
    // Primero lo que sigue sin resolver: es lo que impide cerrar con criterio.
    return [...lista].sort(
      (a, b) => Number(b.clasificacion === 'auditable') - Number(a.clasificacion === 'auditable'),
    )
  }, [items, query])

  async function cerrar() {
    if (!activeWarehouseId) return
    setCerrando(true)
    setError(null)
    try {
      setCerrado(await api.cerrarInventario(activeWarehouseId))
      setConfirmando(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cerrar el inventario.')
    } finally {
      setCerrando(false)
    }
  }

  if (!warehouse) return null

  return (
    <div className="min-h-dvh bg-background pb-40">
      <TopBar title={warehouse.name} subtitle="Consolidado y cierre" backHref="/auditor" roleTag="Auditor" />

      <main className="mx-auto max-w-md px-4">
        {error && (
          <p className="mt-4 flex items-start gap-1.5 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        )}

        {cerrado && (
          <section className="mt-4 rounded-2xl border-2 border-success/40 bg-success-soft/50 p-4">
            <p className="flex items-center gap-1.5 font-display text-base font-extrabold text-success">
              <CheckCircle2 className="h-5 w-5" />
              Inventario cerrado
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {cerrado.articulosActualizados} artículos actualizados en el sistema central con tu aval.
            </p>
          </section>
        )}

        {items === null && !error && (
          <p className="mt-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando el consolidado…
          </p>
        )}

        {resumen && (
          <>
            <section className="mt-4 grid grid-cols-3 gap-2">
              <Dato valor={resumen.total} rotulo="Artículos" />
              <Dato valor={resumen.conciliados} rotulo="Conciliados" tono="success" />
              <Dato valor={resumen.auditables} rotulo="Auditables" tono="warning" />
            </section>

            <div className="my-4">
              <TextField
                label="Buscar artículo"
                placeholder="Nombre o código"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                icon={<Search className="h-4 w-4" />}
                autoComplete="off"
              />
            </div>

            <p className="mb-2 flex items-center gap-1.5 text-xs text-primary">
              <Eye className="h-3.5 w-3.5" />
              La cifra del sistema solo la ves tú.
            </p>

            <ul className="space-y-1.5">
              {visibles.slice(0, 200).map((i) => (
                <li
                  key={`${i.codigo ?? ''}-${i.nombre}`}
                  className={cn(
                    'rounded-xl border-2 bg-card p-3',
                    i.clasificacion === 'auditable' ? 'border-warning-border' : 'border-border',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-foreground">{i.nombre}</span>
                      <span className="block text-xs text-muted-foreground">
                        {i.codigo ? `${i.codigo} · ` : ''}
                        {i.clasificacion === 'auditable'
                          ? leerMotivo(i.motivo)
                          : `${i.rondasAfirmando} ${i.rondasAfirmando === 1 ? 'ronda' : 'rondas'} de acuerdo`}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-display text-sm font-bold text-foreground">
                        {i.valorFinal ?? '—'} <span className="text-[11px] font-normal text-muted-foreground">{i.unidad}</span>
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        sistema: {i.saldoSistema ?? '—'}
                      </span>
                    </span>
                  </div>
                  {i.codigoRazon && (
                    <p className="mt-1.5 text-[11px] text-muted-foreground">Causa: {i.codigoRazon}</p>
                  )}
                </li>
              ))}
            </ul>

            {visibles.length > 200 && (
              <p className="mt-3 text-center text-xs text-muted-foreground">
                Se muestran 200 de {visibles.length}. Descarga la exportación para verlos todos.
              </p>
            )}
          </>
        )}
      </main>

      {items && !cerrado && activeWarehouseId && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 backdrop-blur">
          <div className="mx-auto max-w-md space-y-2 px-4 py-3">
            {/* La descarga es un enlace y no un `fetch`: el archivo lo pide el
                navegador con la misma cookie, y así funciona el "Guardar como"
                del sistema en vez de un blob en memoria. */}
            <a
              href={api.urlExportacion(activeWarehouseId, 'csv')}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-input bg-card font-display text-sm font-bold text-foreground"
            >
              <ArrowDownToLine className="h-[18px] w-[18px]" />
              Descargar consolidado (CSV)
            </a>

            {resumen && resumen.auditables > 0 && (
              <p className="text-center text-xs text-warning-foreground">
                Quedan {resumen.auditables} artículos auditables sin resolver.
              </p>
            )}

            <Button size="block" onClick={() => setConfirmando(true)} disabled={cerrando}>
              <Lock className="h-[18px] w-[18px]" />
              Cerrar inventario
            </Button>
          </div>
        </div>
      )}

      {confirmando && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div role="alertdialog" aria-modal="true" className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-xl">
            <p className="flex items-start gap-2 font-display text-base font-bold text-foreground">
              <Lock className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              Esto mueve el saldo del sistema central
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Hasta ahora ningún conteo ha tocado los saldos: el sistema solo ha acumulado lo que
              cada persona afirmó. Al cerrar, tu consolidado pasa a ser el saldo oficial de{' '}
              <strong>{warehouse.name}</strong>. No se deshace.
            </p>
            {resumen && resumen.auditables > 0 && (
              <p className="mt-2 rounded-lg bg-warning/10 p-2 text-sm text-warning-foreground">
                {resumen.auditables} artículos siguen sin resolver y entrarán como están.
              </p>
            )}
            <div className="mt-4 flex flex-col gap-2">
              <Button size="block" loading={cerrando} onClick={() => void cerrar()}>
                {cerrando ? 'Cerrando…' : 'Sí, cerrar el inventario'}
              </Button>
              <button
                type="button"
                onClick={() => setConfirmando(false)}
                className="h-12 rounded-xl border-2 border-input bg-card font-display text-sm font-bold text-foreground"
              >
                Volver
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Dato({ valor, rotulo, tono }: { valor: number; rotulo: string; tono?: 'success' | 'warning' }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card p-3 text-center',
        tono === 'success' && 'bg-success-soft/40',
        tono === 'warning' && valor > 0 && 'bg-warning-soft/50',
      )}
    >
      <p
        className={cn(
          'font-display text-2xl font-extrabold leading-none text-foreground',
          tono === 'success' && 'text-success',
          tono === 'warning' && valor > 0 && 'text-warning-foreground',
        )}
      >
        {valor.toLocaleString('es-CO')}
      </p>
      <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">{rotulo}</p>
    </div>
  )
}
