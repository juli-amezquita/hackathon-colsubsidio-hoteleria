'use client'

import { AlertTriangle, CheckCircle2, Clock, Copy, HelpCircle, Send } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { RequireRole } from '@/components/require-role'
import { TopBar } from '@/components/top-bar'
import { Button } from '@/components/ui-button'
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
  const {
    ready, activeWarehouseId, active, submitCount, session, getWarehouse,
    error, alertasSinResponder, sostenerConteo,
  } = useCountStore()
  const [enviando, setEnviando] = useState(false)

  const warehouse = getWarehouse(activeWarehouseId)
  const entries = active ? orderedEntries(active.entries) : []
  const { total, anomalies, duplicates, flagged } = progress(entries)
  const submitted = active?.submitted

  // Lo que impide cerrar esta ronda, de ESTA bodega. `pendientes` de la tienda
  // suma todas las bodegas y aquí eso confundiría: lo que bloquea el cierre es
  // lo que aún no llegó al servidor de la ronda que se va a cerrar.
  const enCola = entries.filter((e) => e.estadoEnvio === 'pendiente').length
  const rechazados = entries.filter((e) => e.estadoEnvio === 'rechazado').length

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
            <Row label="Bodega" value={warehouse.name} />
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
            // El veredicto del SERVIDOR manda sobre las banderas locales.
            //
            // Antes el visto verde salía solo de `isAnomaly || isDuplicate ||
            // needsReview`, que son sospechas del dispositivo. El servidor, que
            // es el único que ve el saldo esperado, podía haber marcado
            // discrepancia y la pantalla seguía pintando "sin alertas". Se
            // probó en producción: 10 kg de arroz y 0 kg de arroz, los dos con
            // `alerta_discrepancia`, los dos en verde.
            const alertaDelServidor = entry.validacion?.startsWith('alerta') === true
            // `rechazado` iba dentro de "sin acuse" y salía con un reloj y el
            // rótulo "sin confirmar todavía": no se confirma nunca, el
            // servidor lo rechazó. Se dice cuál de las dos cosas es.
            const rechazado = entry.estadoEnvio === 'rechazado'
            const enEspera = entry.estadoEnvio === 'pendiente'
            const isFlagged =
              alertaDelServidor ||
              rechazado ||
              enEspera ||
              entry.isAnomaly ||
              entry.isDuplicate ||
              entry.needsReview
            return (
              <li
                key={entry.id}
                className={cn(
                  'flex items-center gap-3 rounded-xl border-2 bg-card p-3',
                  rechazado
                    ? 'border-destructive/50'
                    : isFlagged
                      ? 'border-warning-border'
                      : 'border-border',
                )}
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted font-display text-xs font-bold tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-foreground">{entry.name}</p>
                  <p className="truncate text-xs tabular-nums text-muted-foreground">
                    {formatUnit(entry.quantity, entry.unit)}
                  </p>
                  {rechazado && (
                    <p className="text-xs text-destructive">
                      {entry.error ?? 'El sistema no aceptó este conteo.'}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {entry.needsReview && <HelpCircle className="h-4 w-4 text-warning-foreground" aria-label="Revisar" />}
                  {entry.isAnomaly && <AlertTriangle className="h-4 w-4 text-warning-foreground" aria-label="Cantidad inusual" />}
                  {entry.isDuplicate && <Copy className="h-4 w-4 text-warning-foreground" aria-label="Repetido" />}
                  {alertaDelServidor && !entry.alertaRespondida && (
                    <AlertTriangle
                      className="h-4 w-4 text-warning-foreground"
                      aria-label="No cuadra con el sistema"
                    />
                  )}
                  {enEspera && (
                    <Clock className="h-4 w-4 text-muted-foreground" aria-label="Sin enviar todavía" />
                  )}
                  {rechazado && (
                    <AlertTriangle
                      className="h-4 w-4 text-destructive"
                      aria-label="El sistema no aceptó este conteo"
                    />
                  )}
                  {!isFlagged && <CheckCircle2 className="h-4 w-4 text-success" aria-label="Sin alertas" />}
                </div>
              </li>
            )
          })}
        </ol>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 backdrop-blur">
        <div className="mx-auto max-w-md px-4 py-3">
          {/* Lo que impide cerrar, ANTES de que se toque el botón.
              El fallo que esto arregla: el servidor devolvía un bloqueo, la
              tienda lo guardaba en `error`, esta pantalla no lo pintaba, y el
              botón parecía roto. Un botón que no hace nada y no dice por qué es
              peor que un botón deshabilitado. */}
          {alertasSinResponder.length > 0 && (
            <div className="mb-3 rounded-xl border-2 border-warning-border bg-warning/10 p-3">
              <p className="flex items-start gap-1.5 text-sm font-semibold text-warning-foreground">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {alertasSinResponder.length === 1
                  ? 'Un conteo no cuadra con lo que el sistema tiene.'
                  : `${alertasSinResponder.length} conteos no cuadran con lo que el sistema tiene.`}
              </p>
              {/* No se dice en qué dirección ni por cuánto: eso convertiría el
                  conteo ciego en un conteo guiado (FR-2.2). */}
              <p className="mt-1 text-xs text-muted-foreground">
                Sostén tu conteo o vuelve a contarlo. Sin responder no se puede enviar.
              </p>
              <ul className="mt-2 space-y-1.5">
                {alertasSinResponder.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{e.name}</span>
                    <button
                      type="button"
                      onClick={() => sostenerConteo(e.id)}
                      className="shrink-0 rounded-lg bg-warning-foreground px-2.5 py-1 text-xs font-bold text-white"
                    >
                      Sostengo {e.quantity}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Cerrar con la cola a medio vaciar es la forma más silenciosa de
              perder trabajo: lo que aún no llegó al servidor vuelve del cuadre
              como pendiente y el cierre lo graba `no_contado`. Conteos reales
              convertidos en "nadie lo contó". Por eso no se cierra hasta que la
              cola esté en cero, y se dice qué falta. */}
          {enCola > 0 && (
            <div className="mb-3 flex items-start gap-1.5 rounded-xl border-2 border-warning-border bg-warning/10 p-3">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" />
              <span className="text-sm text-warning-foreground">
                <span className="font-semibold tabular-nums">
                  {enCola} {enCola === 1 ? 'conteo' : 'conteos'}
                </span>{' '}
                todavía no {enCola === 1 ? 'llegó' : 'llegaron'} al sistema. Se envían solos en
                cuanto haya señal; cerrar ahora {enCola === 1 ? 'lo daría' : 'los daría'} por no
                contados.
              </span>
            </div>
          )}

          {rechazados > 0 && (
            <div className="mb-3 flex items-start gap-1.5 rounded-xl border-2 border-destructive/40 bg-destructive/10 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <span className="text-sm text-destructive">
                El sistema no aceptó{' '}
                <span className="font-semibold tabular-nums">
                  {rechazados} {rechazados === 1 ? 'conteo' : 'conteos'}
                </span>
                . Vuelve a la lista, {rechazados === 1 ? 'corrígelo' : 'corrígelos'} o{' '}
                {rechazados === 1 ? 'quítalo' : 'quítalos'} antes de cerrar.
              </span>
            </div>
          )}

          {error && (
            <p
              role="alert"
              className="mb-3 flex items-start gap-1.5 rounded-lg bg-destructive/10 p-2 text-sm text-destructive"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </p>
          )}

          <Button
            size="block"
            loading={enviando}
            onClick={() => {
              setEnviando(true)
              void submitCount().finally(() => setEnviando(false))
            }}
            disabled={
              total === 0 ||
              enviando ||
              alertasSinResponder.length > 0 ||
              enCola > 0 ||
              rechazados > 0
            }
          >
            <Send className="h-[18px] w-[18px]" />
            {enviando ? 'Enviando…' : 'Enviar conteo al auditor'}
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
          'font-display text-2xl font-extrabold leading-none tabular-nums',
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
