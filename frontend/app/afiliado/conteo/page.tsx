'use client'

import {
  AlertTriangle,
  Check,
  Copy,
  HelpCircle,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Trash2,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AudioPlayButton } from '@/components/audio-play-button'
import { QuantityField } from '@/components/quantity-field'
import { RequireRole } from '@/components/require-role'
import { TextField } from '@/components/text-field'
import { TopBar } from '@/components/top-bar'
import { UnitSelect } from '@/components/unit-select'
import { Button } from '@/components/ui-button'
import { ValidationDialog, type ValidationAlert } from '@/components/validation-dialog'
import { AgentePanel } from '@/components/agente-panel'
import type { ItemConfirmado } from '@/lib/agente-voz'
import { deleteAudio, saveAudio } from '@/lib/audio-store'
import type { ArticuloDeTrabajo } from '@cci/contracts'

import { unidadDesdeServidor, type Unit, type Warehouse } from '@/lib/data'
import { ANOMALY_MAX, findDuplicate, formatUnit, orderedEntries, progress } from '@/lib/inventory'
import { useCountStore, type CountEntry } from '@/lib/store'
import { parseSpeech } from '@/lib/voice'
import { cn } from '@/lib/utils'

export default function ConteoPage() {
  return (
    <RequireRole role="afiliado">
      <Conteo />
    </RequireRole>
  )
}

type Phase = 'idle' | 'confirm'

function Conteo() {
  const router = useRouter()
  const {
    ready, activeWarehouseId, active, addEntry, updateEntry, removeEntry,
    getWarehouse, resolver, idDeUnidad, catalogo, pendientes, error: errorSync,
    reportarHallazgo, alertasSinResponder, sostenerConteo,
  } = useCountStore()

  const warehouse = getWarehouse(activeWarehouseId)
  const entries = useMemo(() => (active ? orderedEntries(active.entries) : []), [active])

  const [phase, setPhase] = useState<Phase>('idle')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  // Cuando el catálogo no resuelve solo, se muestran candidatos: el sistema
  // no elige en caso de duda, pregunta (FR-1.27).
  const [noResuelto, setNoResuelto] = useState<ArticuloDeTrabajo[] | null>(null)
  const [quantity, setQuantity] = useState(0)
  const [unit, setUnit] = useState<Unit>('unidad')
  const [transcript, setTranscript] = useState('')
  const [unclear, setUnclear] = useState(false)
  const [unitError, setUnitError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const nameRef = useRef<HTMLInputElement | null>(null)
  const quantityRef = useRef<HTMLInputElement | null>(null)
  // Clip de audio recién grabado, pendiente de guardar en IndexedDB al confirmar
  const pendingAudioRef = useRef<Blob | null>(null)

  // Sin bodega activa: volver a la selección
  useEffect(() => {
    if (ready && !activeWarehouseId) router.replace('/afiliado')
  }, [ready, activeWarehouseId, router])

  if (!warehouse) return null

  const { total, flagged } = progress(entries)
  const duplicate = findDuplicate(name, entries, editingId ?? undefined)
  const anomaly = quantity > ANOMALY_MAX

  function resetForm() {
    setName('')
    setQuantity(0)
    setUnit('unidad')
    setUnitError(null)
    setTranscript('')
    setUnclear(false)
    setEditingId(null)
    pendingAudioRef.current = null
  }


  function startManual() {
    resetForm()
    setPhase('confirm')
    window.setTimeout(() => nameRef.current?.focus(), 50)
  }

  function startEdit(id: string) {
    const entry = entries.find((e) => e.id === id)
    if (!entry) return
    // Al editar manualmente no hay audio nuevo; conservamos el ya guardado
    pendingAudioRef.current = null
    setEditingId(id)
    setName(entry.name)
    setQuantity(entry.quantity)
    setUnit(entry.unit)
    setTranscript(entry.transcript)
    setUnclear(entry.needsReview)
    setPhase('confirm')
  }

  function handleRemove(id: string) {
    const entry = entries.find((e) => e.id === id)
    if (entry?.audioId) void deleteAudio(entry.audioId)
    removeEntry(id)
  }

  function buildAlerts(): ValidationAlert[] {
    const alerts: ValidationAlert[] = []
    if (unclear) {
      alerts.push({
        kind: 'unclear',
        detail: 'No entendimos bien el audio. Revisa que el nombre, la cantidad y la unidad estén correctos.',
      })
    }
    if (anomaly) {
      alerts.push({
        kind: 'anomaly',
        detail: `Registraste ${quantity.toLocaleString('es-CO')} ${unit}. Confirma que el conteo físico es correcto.`,
      })
    }
    if (duplicate) {
      alerts.push({
        kind: 'duplicate',
        detail: `Ya contaste “${duplicate.name}” antes. Confirma que quieres agregarlo de nuevo.`,
      })
    }
    return alerts
  }

  /**
   * El agente confirmó un artículo con el operario. Entra a la cola.
   *
   * El servidor NO lo guarda por su cuenta: se encola aquí, igual que un
   * conteo escrito, con la misma clave de idempotencia y el mismo reintento
   * (F-18). Si la ruta por voz escribiera directo, un corte de Wi-Fi perdería
   * lo dictado y conservaría lo tecleado — y nadie sabría por qué.
   */
  function confirmarPorVoz(item: ItemConfirmado) {
    const articulo = catalogo.find((a) => a.articuloId === item.articuloId)
    if (!articulo) return

    // La unidad del artículo cuando el operario no dijo ninguna. Es la que el
    // catálogo declara, no una suposición nuestra.
    const unidadId = item.unidad ? idDeUnidad(unidadDesdeServidor(item.unidad)) : null

    addEntry({
      articuloId: articulo.articuloId,
      name: articulo.nombre,
      quantity: item.cantidad,
      unit: unidadDesdeServidor(item.unidad ?? articulo.unidadEsperada.nombre),
      unidadId: unidadId ?? articulo.unidadEsperada.id,
      isAnomaly: item.cantidad > ANOMALY_MAX,
      isDuplicate: Boolean(findDuplicate(articulo.nombre, entries)),
      // Ya se confirmó hablando: no hay nada que revisar en pantalla.
      needsReview: false,
      transcript: item.dictado,
    })
  }

  async function persist() {
    // Guardamos el clip de audio en IndexedDB (si se grabó por voz)
    let audioId: string | undefined
    const blob = pendingAudioRef.current
    if (blob) {
      audioId = (await saveAudio(blob)) ?? undefined
    }

    // El nombre dictado se resuelve contra el catálogo CACHEADO de la bodega,
    // sin red (F-21b): si dependiera del servidor, un microcorte impediría
    // contar, no solo enviar. El servidor vuelve a resolverlo al recibirlo y es
    // la autoridad; si difiere, marca el registro para el Auditor en vez de
    // corregirlo en silencio (FR-6.9).
    const resuelto = resolver(name.trim())

    if (!resuelto.articulo) {
      setNoResuelto(resuelto.candidatos)
      return
    }

    // La unidad viaja como el id del catálogo, resuelto AQUÍ y no al enviar:
    // el envío puede ocurrir horas después, con otra bodega abierta. Y se
    // resuelve la unidad ELEGIDA, no la que el artículo espera — mandar
    // siempre la esperada apagaría la alerta de unidad (FR-2.1) para siempre.
    const unidadId = idDeUnidad(unit)
    if (!unidadId) {
      setUnitError(`Esta bodega no maneja ${formatUnit(2, unit)}.`)
      return
    }

    const payload: Partial<Omit<CountEntry, 'id' | 'order'>> = {
      articuloId: resuelto.articulo.articuloId,
      // Se guarda el nombre DEL CATÁLOGO, no el que se dictó: es el que el
      // Auditor va a leer y el que viaja al sistema central.
      name: resuelto.articulo.nombre,
      quantity,
      unit,
      unidadId,
      isAnomaly: anomaly,
      isDuplicate: Boolean(duplicate),
      needsReview: unclear || resuelto.candidatos.length > 0,
      transcript,
    }

    if (editingId) {
      // Si hay un nuevo audio, reemplaza el anterior en IndexedDB
      if (audioId) {
        const prev = entries.find((e) => e.id === editingId)
        if (prev?.audioId) void deleteAudio(prev.audioId)
        payload.audioId = audioId
      }
      updateEntry(editingId, payload)
    } else {
      if (audioId) payload.audioId = audioId
      addEntry(payload as Parameters<typeof addEntry>[0])
    }
    resetForm()
    setPhase('idle')
  }

  function handleAdd() {
    if (!name.trim()) {
      nameRef.current?.focus()
      return
    }
    if (quantity <= 0) {
      quantityRef.current?.focus()
      return
    }
    if (buildAlerts().length > 0) {
      setDialogOpen(true)
      return
    }
    void persist()
  }

  return (
    <div className="min-h-dvh bg-background pb-28">
      <TopBar
        title={warehouse.name}
        subtitle="Conteo por voz"
        backHref="/afiliado"
        roleTag="Afiliado"
      />

      <main className="mx-auto max-w-md px-4">
        {/* Resumen del avance */}
        <section className="mt-4 flex items-center justify-between rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Productos contados</p>
            <p className="font-display text-3xl font-extrabold leading-none text-primary">{total}</p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Por validar</p>
            <p
              className={cn(
                'font-display text-3xl font-extrabold leading-none',
                flagged > 0 ? 'text-warning-foreground' : 'text-foreground',
              )}
            >
              {flagged}
            </p>
          </div>
        </section>

        {/* Zona de captura */}
        {phase === 'idle' ? (
          <div className="mt-4">
            {active?.rondaId ? (
              <AgentePanel
                rondaId={active.rondaId}
                onConfirmar={confirmarPorVoz}
                onHallazgo={(i) =>
                  void reportarHallazgo({
                    nombre: i.nombre,
                    cantidad: i.cantidad,
                    unidad: i.unidad,
                  })
                }
                onSostener={(registroId) => {
                  const e = entries.find((x) => x.registroId === registroId)
                  if (e) sostenerConteo(e.id)
                }}
                alertas={alertasSinResponder.map((e) => ({
                  registroId: e.registroId ?? e.id,
                  articuloId: e.articuloId,
                  nombre: e.name,
                  cantidad: e.quantity,
                }))}
                onEscribir={startManual}
              />
            ) : (
              <section className="rounded-2xl border border-border bg-card p-5 text-center shadow-sm">
                <p className="text-sm text-muted-foreground">Abriendo la ronda…</p>
              </section>
            )}
          </div>
        ) : (
          <section className="mt-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h2 className="font-display text-base font-bold text-foreground">
              {editingId ? 'Editar producto' : 'Confirma el producto'}
            </h2>

            {transcript && (
              <p className="mt-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">Escuché:</span> “{transcript}”
              </p>
            )}

            <div className="mt-3">
              <TextField
                ref={nameRef}
                label="Producto"
                placeholder="Nombre del producto"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setUnclear(false)
                }}
                autoComplete="off"
              />
            </div>

            <label htmlFor="qty" className="mb-1.5 block text-sm font-semibold text-foreground">
              Cantidad
            </label>
            <QuantityField
              id="qty"
              ref={quantityRef}
              value={quantity}
              onChange={(v) => {
                setQuantity(v)
                setUnclear(false)
              }}
              invalid={anomaly}
            />
            {/* Altura reservada para avisos */}
            <div className="mb-3 mt-1 min-h-4">
              {quantity <= 0 ? (
                <p className="text-xs text-muted-foreground">Ingresa una cantidad mayor a cero.</p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {unclear && (
                    <p className="flex items-center gap-1 text-xs text-warning-foreground">
                      <HelpCircle className="h-3 w-3" /> Revisa los datos: el audio no fue claro.
                    </p>
                  )}
                  {anomaly && (
                    <p className="flex items-center gap-1 text-xs text-warning-foreground">
                      <AlertTriangle className="h-3 w-3" /> Cantidad inusual, verifica el conteo.
                    </p>
                  )}
                  {duplicate && (
                    <p className="flex items-center gap-1 text-xs text-warning-foreground">
                      <Copy className="h-3 w-3" /> Ya contaste este producto antes.
                    </p>
                  )}
                </div>
              )}
            </div>

            <p className="mb-1.5 block text-sm font-semibold text-foreground">Unidad</p>
            <UnitSelect
              value={unit}
              onChange={(u) => {
                setUnit(u)
                setUnclear(false)
                setUnitError(null)
              }}
            />
            {unitError && (
              <p className="mt-1.5 flex items-start gap-1.5 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {unitError}
              </p>
            )}

            <div className="mt-5 flex flex-col gap-2">
              <Button size="block" onClick={handleAdd} disabled={!name.trim() || quantity <= 0}>
                <Check className="h-[18px] w-[18px]" />
                {editingId ? 'Guardar cambios' : 'Agregar a la lista'}
              </Button>
              <Button
                variant="ghost"
                size="block"
                onClick={() => {
                  resetForm()
                  setPhase('idle')
                }}
              >
                <RotateCcw className="h-[18px] w-[18px]" />
                {editingId ? 'Cancelar' : 'Volver a grabar'}
              </Button>
            </div>
          </section>
        )}

        {/* Lista de productos contados */}
        <div className="mb-2 mt-6 flex items-center justify-between">
          <h2 className="font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">
            Productos contados
          </h2>
          <span className="text-xs text-muted-foreground">{total} en total</span>
        </div>

        {entries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-muted">
              <Plus className="h-6 w-6 text-muted-foreground" />
            </span>
            <p className="mt-3 text-sm text-muted-foreground">
              Aún no hay productos. Toca el micrófono y di el primero.
            </p>
          </div>
        ) : (
          <ol className="space-y-2">
            {entries.map((entry, i) => (
              <li
                key={entry.id}
                className={cn(
                  'flex items-center gap-3 rounded-xl border-2 bg-card p-3',
                  entry.isAnomaly || entry.isDuplicate || entry.needsReview
                    ? 'border-warning-border'
                    : 'border-border',
                )}
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted font-display text-xs font-bold text-muted-foreground">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-foreground">{entry.name}</p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                    <span className="font-medium text-foreground">
                      {formatUnit(entry.quantity, entry.unit)}
                    </span>
                    {entry.needsReview && (
                      <span className="inline-flex items-center gap-0.5 text-warning-foreground">
                        <HelpCircle className="h-3 w-3" /> revisar
                      </span>
                    )}
                    {entry.isAnomaly && (
                      <span className="inline-flex items-center gap-0.5 text-warning-foreground">
                        <AlertTriangle className="h-3 w-3" /> inusual
                      </span>
                    )}
                    {entry.isDuplicate && (
                      <span className="inline-flex items-center gap-0.5 text-warning-foreground">
                        <Copy className="h-3 w-3" /> repetido
                      </span>
                    )}
                  </div>
                  {entry.audioId && (
                    <div className="mt-1.5">
                      <AudioPlayButton audioId={entry.audioId} label={`Escuchar ${entry.name}`} />
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => startEdit(entry.id)}
                  aria-label={`Editar ${entry.name}`}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleRemove(entry.id)}
                  aria-label={`Eliminar ${entry.name}`}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ol>
        )}
      </main>

      {/* Barra de acción fija */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 backdrop-blur">
        <div className="mx-auto max-w-md px-4 py-3">
          <Button
            size="block"
            onClick={() => router.push('/afiliado/resumen')}
            disabled={entries.length === 0}
          >
            <Send className="h-[18px] w-[18px]" />
            {entries.length === 0 ? 'Agrega productos para continuar' : 'Revisar y enviar conteo'}
          </Button>
        </div>
      </div>

      <ValidationDialog
        open={dialogOpen}
        name={name.trim()}
        quantity={quantity}
        unit={unit}
        alerts={buildAlerts()}
        onConfirm={() => {
          setDialogOpen(false)
          void persist()
        }}
        onCorrect={() => {
          setDialogOpen(false)
          if (!name.trim()) nameRef.current?.focus()
          else quantityRef.current?.focus()
        }}
      />
    </div>
  )
}
