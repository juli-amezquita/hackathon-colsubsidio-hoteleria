'use client'

import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronLeft,
  Eye,
  ListX,
  Loader2,
  PackageSearch,
  Ruler,
  Scale,
  Users,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState, type ReactNode } from 'react'

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
        {error && <Fallo>{error}</Fallo>}

        {items === null && !error && <Cargando texto="Cargando la cola…" />}

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

/**
 * Un caso de la bandeja. **Dos clases de caso, dos expedientes.**
 *
 * La bandeja mezcla artículos del catálogo con hallazgos sin catálogo porque
 * para el Auditor son la misma clase de trabajo. La evidencia no lo es: uno se
 * compara contra un saldo del ERP y el otro no existe en el ERP. Aquí se parten.
 *
 * Antes esto era un solo componente que salía por `if (!pendiente.articuloId)
 * return` antes de cargar nada: un hallazgo abría una tarjeta informativa sin
 * formulario, así que **no se podía cerrar nunca**. Y como el cierre del
 * inventario exige que no quede ninguna discrepancia abierta, un solo hallazgo
 * bloqueaba la bodega entera de forma permanente.
 */
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
  if (pendiente.fantasmaId) {
    return (
      <CasoDeHallazgo
        bodegaId={bodegaId}
        fantasmaId={pendiente.fantasmaId}
        pendiente={pendiente}
        onCerrar={onCerrar}
        onResuelto={onResuelto}
      />
    )
  }

  if (pendiente.articuloId) {
    return (
      <CasoDeArticulo
        bodegaId={bodegaId}
        articuloId={pendiente.articuloId}
        pendiente={pendiente}
        onCerrar={onCerrar}
        onResuelto={onResuelto}
      />
    )
  }

  // Una discrepancia que no apunta ni a un artículo ni a un hallazgo no debería
  // existir. Si llega, se dice: sigue contando para el bloqueo del cierre.
  return (
    <Expediente
      titulo={pendiente.nombre}
      subtitulo={leerMotivo(pendiente.motivo)}
      onCerrar={onCerrar}
    >
      <Fallo>
        Este caso no apunta a ningún artículo ni a ningún hallazgo, así que no hay expediente que
        mostrar. Repórtalo: mientras siga abierto, el inventario de la bodega no se puede cerrar.
      </Fallo>
    </Expediente>
  )
}

/** El expediente de un artículo del catálogo: qué contó cada ronda contra el saldo. */
function CasoDeArticulo({
  bodegaId,
  articuloId,
  pendiente,
  onCerrar,
  onResuelto,
}: {
  bodegaId: string
  articuloId: string
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
    api
      .casoDeAuditoria(bodegaId, articuloId)
      .then(setCaso)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'No se pudo abrir el caso.'))
  }, [bodegaId, articuloId])

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

  const falta = cantidad <= 0 ? 'Escribe la cantidad que contaste' : !razon ? 'Elige la causa' : null

  return (
    <Expediente
      titulo={pendiente.nombre}
      subtitulo={leerMotivo(pendiente.motivo)}
      onCerrar={onCerrar}
      pie={
        caso && (
          <Pie
            texto="Registrar reconteo"
            cargando={enviando}
            deshabilitado={falta !== null}
            aviso={falta}
            onEnviar={() => void resolver()}
          />
        )
      }
    >
      {!caso && !error && <Cargando texto="Abriendo el caso…" />}
      {error && <Fallo>{error}</Fallo>}

      {caso && (
        <>
          {/* El saldo esperado: lo único de todo el sistema que solo este rol
              puede ver. Por eso se marca explícitamente. */}
          <section className="mt-4 rounded-2xl border-2 border-primary/30 bg-primary-soft/40 p-4">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-primary">
              <Eye className="h-3.5 w-3.5" />
              Solo tú ves esto
            </p>
            <p className="mt-1 font-display text-3xl font-extrabold leading-none tabular-nums text-foreground">
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

          {/* Lo que dijo cada ronda. No una cifra ya reconciliada: el Auditor
              recibe el histórico completo y decide él. */}
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
                      <span className="block text-xs tabular-nums text-muted-foreground">
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

          {/* El árbitro ORDENA la evidencia; no dice quién tiene razón. Por eso
              se presenta como relato y preguntas, nunca como una cifra
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
                    <span className="font-semibold tabular-nums text-foreground">
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

            <SelectorDeCausa codigos={codigos} valor={razon} onChange={setRazon} />
          </section>
        </>
      )}
    </Expediente>
  )
}

/**
 * El expediente de un hallazgo sin catálogo (H5-05).
 *
 * Mismo rigor que un artículo, con **una diferencia que no se disimula**: aquí
 * no hay saldo esperado ni diferencia, y no porque falte el dato. El producto no
 * existe en el catálogo del ERP, así que no hay ninguna cifra del sistema contra
 * la cual restar (FR-5.4). Un «—» donde el artículo pone su saldo insinuaría un
 * número escondido; se dice con palabras.
 */
function CasoDeHallazgo({
  bodegaId,
  fantasmaId,
  pendiente,
  onCerrar,
  onResuelto,
}: {
  bodegaId: string
  fantasmaId: string
  pendiente: Pendiente
  onCerrar: () => void
  onResuelto: () => void
}) {
  const codigos = useCodigosRazon()
  const [caso, setCaso] = useState<api.CasoFantasma | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cantidad, setCantidad] = useState(0)
  const [unidadId, setUnidadId] = useState('')
  const [razon, setRazon] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    api
      .casoDeFantasma(bodegaId, fantasmaId)
      .then(setCaso)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : 'No se pudo abrir el hallazgo.'),
      )
  }, [bodegaId, fantasmaId])

  /**
   * Las unidades del catálogo controlado que este caso pone al alcance.
   *
   * `unidadObservada` es texto libre —"caja", "bulto"—: es lo que el operario
   * dijo, no una fila de `unidad_medida`. El reconteo sí se guarda contra una de
   * esas filas, así que el Auditor tiene que declarar en cuál contó.
   *
   * Salen del catálogo controlado, que ahora viaja en la respuesta. Antes se
   * derivaban de los candidatos descartados, y el caso común es que no haya
   * ninguno: entonces no había ni una unidad que ofrecer, el hallazgo no se
   * podía resolver, y como el cierre exige que no queden discrepancias
   * abiertas, un solo hallazgo bloqueaba el inventario de la bodega.
   *
   * Las de los candidatos descartados van primero: si el catálogo llegó a
   * ofrecer algo parecido, su unidad es la apuesta razonable.
   */
  const unidades = useMemo(() => {
    if (!caso) return []
    const preferidas = new Set(caso.candidatosDescartados.map((c) => c.unidadEsperada.id))
    return [...caso.unidades].sort(
      (a, b) => Number(preferidas.has(b.id)) - Number(preferidas.has(a.id)),
    )
  }, [caso])

  // Una sola opción no es una decisión: se deja puesta. Con varias se elige,
  // porque el sistema no escoge por el Auditor.
  useEffect(() => {
    const unica = unidades.length === 1 ? unidades[0] : undefined
    if (unica) setUnidadId(unica.id)
  }, [unidades])

  async function resolver() {
    if (!caso || !razon || !unidadId || cantidad <= 0) return
    setEnviando(true)
    setError(null)
    try {
      await api.resolverFantasma(bodegaId, caso.fantasmaId, {
        cantidad,
        unidadId,
        codigoRazonId: razon,
      })
      onResuelto()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar la resolución.')
      setEnviando(false)
    }
  }

  const falta =
    cantidad <= 0
      ? 'Escribe la cantidad que contaste'
      : !unidadId
        ? 'Elige la unidad en la que lo contaste'
        : !razon
          ? 'Elige la causa'
          : null

  return (
    <Expediente
      titulo={pendiente.nombre}
      subtitulo={leerMotivo(pendiente.motivo)}
      onCerrar={onCerrar}
      pie={
        caso && (
          <Pie
            texto="Registrar resolución"
            cargando={enviando}
            deshabilitado={falta !== null}
            aviso={falta}
            onEnviar={() => void resolver()}
          />
        )
      }
    >
      {!caso && !error && <Cargando texto="Abriendo el hallazgo…" />}
      {error && <Fallo>{error}</Fallo>}

      {caso && (
        <>
          {/* Donde el artículo enseña su saldo esperado, aquí va la ausencia de
              saldo — escrita, no insinuada con un guion. */}
          <section className="mt-4 rounded-2xl border-2 border-warning-border bg-warning-soft/50 p-4">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-warning-foreground">
              <PackageSearch className="h-3.5 w-3.5" />
              Hallazgo sin catálogo
            </p>
            <p className="mt-1 font-display text-3xl font-extrabold leading-none tabular-nums text-foreground">
              {caso.cantidad}{' '}
              <span className="text-base font-bold text-muted-foreground">
                {caso.unidadObservada}
              </span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Lo reportó {caso.operador} · {momento(caso.recibidoEn)}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Este producto no está en el catálogo de la bodega, así que el sistema central no tiene
              ningún saldo suyo: <strong>no hay saldo esperado ni diferencia que calcular</strong>.
              Que estuviera en el estante y no en el catálogo es, exactamente, el hallazgo.
            </p>
          </section>

          {/* La descripción, tal cual la dictó quien lo tenía en la mano. Es lo
              único que identifica al hallazgo: no hay código ni nombre canónico. */}
          <section className="mt-4">
            <h2 className="font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">
              Cómo lo describió el operario
            </h2>
            <p className="mt-2 rounded-xl border border-border bg-card p-3 text-sm text-foreground">
              {caso.descripcion}
            </p>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Dijo «{caso.unidadObservada}» como unidad, y así queda: es texto suyo, no una unidad
              del catálogo.
            </p>
          </section>

          {/* Lo que el sistema ofreció ANTES de crear el hallazgo y la persona
              descartó. Enseñarlo importa: el Auditor puede ver que sí había uno
              que servía y que el hallazgo sobra. */}
          <section className="mt-4">
            <h2 className="flex items-center gap-1.5 font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">
              <ListX className="h-4 w-4" />
              Lo que el catálogo ofreció y él descartó
            </h2>
            {caso.candidatosDescartados.length === 0 ? (
              <p className="mt-2 rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">
                El catálogo no tenía nada parecido a esa descripción, así que no hubo nada que
                descartar.
              </p>
            ) : (
              <>
                <ul className="mt-2 space-y-1.5">
                  {caso.candidatosDescartados.map((c) => (
                    <li key={c.articuloId} className="rounded-xl border border-border bg-card p-3">
                      <span className="block truncate text-sm font-semibold text-foreground">
                        {c.nombre}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {c.codigo ? `${c.codigo} · ` : ''}se cuenta en {c.unidadEsperada.nombre}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] italic text-muted-foreground">
                  El sistema le enseñó esta lista y respondió que no era ninguno. Si tú ves que sí lo
                  era, eso es lo que hay que resolver antes de contar nada.
                </p>
              </>
            )}
          </section>

          {/* Hallazgos de otras rondas. Se PRESENTAN, nunca fusionados (FR-5.5). */}
          <section className="mt-4">
            <h2 className="flex items-center gap-1.5 font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">
              <Boxes className="h-4 w-4" />
              Otros hallazgos de esta bodega
            </h2>
            {caso.otrosHallazgos.length === 0 ? (
              <p className="mt-2 rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">
                Ninguno. Este es el único hallazgo sin catálogo de la bodega.
              </p>
            ) : (
              <>
                <ul className="mt-2 space-y-1.5">
                  {caso.otrosHallazgos.map((o) => (
                    <li key={o.fantasmaId} className="rounded-xl border border-border bg-card p-3">
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-foreground">
                            {o.descripcion}
                          </span>
                          <span className="block text-xs text-muted-foreground">{o.operador}</span>
                        </span>
                        <span className="shrink-0 font-display text-sm font-bold tabular-nums text-foreground">
                          {o.cantidad}
                        </span>
                      </div>
                      {/* De la misma ronda son dos cosas distintas: la misma
                          persona los reportó por separado. De rondas distintas
                          pueden ser la misma caja vista dos veces. */}
                      <span
                        className={cn(
                          'mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold',
                          o.rondaId === caso.rondaId
                            ? 'bg-muted text-muted-foreground'
                            : 'bg-warning-soft text-warning-foreground',
                        )}
                      >
                        {o.rondaId === caso.rondaId ? 'Misma ronda' : 'Otra ronda'}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] italic text-muted-foreground">
                  Dos rondas pueden estar describiendo la misma caja, o dos cajas distintas.
                  Decidirlo comparando textos es justo lo que el sistema no hace por su cuenta: te
                  los enseña y decides tú.
                </p>
              </>
            )}
          </section>

          {/* La resolución. Cantidad y causa, igual que un artículo: un hallazgo
              no se cierra "aceptándolo", se cierra con un número y un porqué. */}
          <section className="mt-4 rounded-2xl border border-border bg-card p-4 shadow-sm">
            <h2 className="font-display text-sm font-bold text-foreground">Tu resolución</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Cuánto hay de verdad en el estante y por qué apareció algo que el catálogo no tiene.
            </p>

            <div className="mt-3">
              <QuantityField value={cantidad} onChange={setCantidad} />
            </div>

            <p className="mb-1.5 mt-4 flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Ruler className="h-4 w-4 text-muted-foreground" />
              Unidad
            </p>
            {unidades.length === 0 ? (
              // Defensa, no camino esperado: el servidor manda siempre el
              // catálogo de unidades. Si alguna vez llegara vacío, más vale
              // decirlo que enseñar un formulario que no puede enviarse.
              <p className="rounded-xl border-2 border-warning-border bg-warning-soft/50 p-3 text-sm text-warning-foreground">
                No llegó el catálogo de unidades, así que no se puede registrar el reconteo desde
                aquí. Vuelve a abrir el caso; si sigue igual, avisa a soporte.
              </p>
            ) : (
              <>
                <div
                  className="flex flex-wrap gap-2"
                  role="radiogroup"
                  aria-label="Unidad del reconteo"
                >
                  {unidades.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      role="radio"
                      aria-checked={unidadId === u.id}
                      onClick={() => setUnidadId(u.id)}
                      className={cn(
                        'h-11 rounded-lg border-2 px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        unidadId === u.id
                          ? 'border-primary bg-primary-soft text-primary'
                          : 'border-border bg-card text-muted-foreground hover:border-input',
                      )}
                    >
                      {u.nombre}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  El operario contó en «{caso.unidadObservada}». Di en cuál de las unidades del
                  catálogo lo contaste tú.
                </p>
              </>
            )}

            <SelectorDeCausa codigos={codigos} valor={razon} onChange={setRazon} />
          </section>
        </>
      )}
    </Expediente>
  )
}

/** La lámina a pantalla completa del expediente. La misma para las dos ramas. */
function Expediente({
  titulo,
  subtitulo,
  onCerrar,
  pie,
  children,
}: {
  titulo: string
  subtitulo: string
  onCerrar: () => void
  pie?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <TopBar title={titulo} subtitle={subtitulo} roleTag="Auditor" />
      <button
        type="button"
        onClick={onCerrar}
        className="absolute left-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-full bg-card/80"
        aria-label="Volver a la lista"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>

      <div className="flex-1 overflow-y-auto pb-6">
        <div className="mx-auto max-w-md px-4">{children}</div>
      </div>

      {pie}
    </div>
  )
}

/**
 * El catálogo controlado de causas.
 *
 * Es el mismo en las dos ramas, y a propósito: un hallazgo sin catálogo no se
 * cierra con menos explicación que un artículo (R4, FR-4.4).
 */
function SelectorDeCausa({
  codigos,
  valor,
  onChange,
}: {
  codigos: { id: string; descripcion: string }[]
  valor: string
  onChange: (id: string) => void
}) {
  return (
    <>
      <p className="mb-1.5 mt-4 text-sm font-semibold text-foreground">Causa</p>
      <div className="space-y-1.5">
        {codigos.map((c) => (
          <label
            key={c.id}
            className={cn(
              'flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border-2 p-2.5 text-sm transition-colors',
              valor === c.id ? 'border-primary bg-primary-soft/40' : 'border-input bg-card',
            )}
          >
            <input
              type="radio"
              name="causa"
              value={c.id}
              checked={valor === c.id}
              onChange={() => onChange(c.id)}
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
    </>
  )
}

/** La barra de acción. Dice qué falta en vez de solo apagarse. */
function Pie({
  texto,
  cargando,
  deshabilitado,
  aviso,
  onEnviar,
}: {
  texto: string
  cargando: boolean
  deshabilitado: boolean
  aviso: string | null
  onEnviar: () => void
}) {
  return (
    <div className="border-t border-border bg-card/95 backdrop-blur">
      <div className="mx-auto max-w-md px-4 py-3">
        <Button
          size="block"
          loading={cargando}
          disabled={deshabilitado || cargando}
          onClick={onEnviar}
        >
          <CheckCircle2 className="h-[18px] w-[18px]" />
          {cargando ? 'Registrando…' : texto}
        </Button>
        {aviso && <p className="mt-2 text-center text-xs text-muted-foreground">{aviso}</p>}
      </div>
    </div>
  )
}

function Cargando({ texto }: { texto: string }) {
  return (
    <p className="mt-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      {texto}
    </p>
  )
}

/** Todo error se pinta. Callarlo deja al Auditor pulsando un botón muerto. */
function Fallo({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 flex items-start gap-1.5 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      {children}
    </p>
  )
}

/** Cuándo se reportó: sitúa el hallazgo en una jornada concreta. */
function momento(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
