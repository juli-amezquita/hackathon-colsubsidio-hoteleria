'use client'

import { Boxes, Coins, Info, Target } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useMemo, useState } from 'react'

import { BarrasApiladas, Cifra, COLOR, Proporcion, type Tramo } from '@/components/admin/graficos'
import { Estado, Filtros, MarcoAdmin, Sello } from '@/components/admin/marco'
import { RequireRole } from '@/components/require-role'
import * as m from '@/lib/metricas'
import { cn } from '@/lib/utils'

/**
 * El Resumen del tablero: el informe comparativo que pidió el cliente.
 *
 * Contesta dos preguntas y ninguna más. La primera es la de la gerencia —"¿en
 * qué bodega hay que mirar este mes?"— y por eso el comparativo NUNCA sale en
 * orden alfabético: la bodega que peor está tiene que aparecer arriba, o la
 * pantalla obliga a leerla entera para descubrir lo único que importaba. La
 * segunda es la del cierre contable —"¿cuánto costó?"— y esa tiene una respuesta
 * incómoda que se cuenta abajo.
 *
 * Todas las cifras llegan calculadas del servidor (`/metricas/resumen`). Lo
 * único que se deriva aquí es el tramo "sin resolver" de la barra, y por una
 * razón puramente geométrica que está anotada donde ocurre.
 */

export default function PaginaResumenAdmin() {
  return (
    <RequireRole role="admin">
      {/* `useSearchParams` exige un límite de Suspense en el App Router: sin él
          el build falla al prerenderizar la ruta. */}
      <Suspense fallback={<Esqueleto />}>
        <Resumen />
      </Suspense>
    </RequireRole>
  )
}

function Esqueleto() {
  return (
    <MarcoAdmin titulo="Resumen" subtitulo="Comparativo de bodegas">
      <Estado cargando error={null}>{null}</Estado>
    </MarcoAdmin>
  )
}

type Orden = 'diferencias' | 'precision'

const ORDENES: { id: Orden; rotulo: string; explicacion: string }[] = [
  {
    id: 'diferencias',
    rotulo: 'Más diferencias',
    explicacion: 'De más a menos referencias con diferencia. Dice dónde hay más trabajo pendiente.',
  },
  {
    id: 'precision',
    rotulo: 'Peor precisión',
    explicacion:
      'De menor a mayor porcentaje de aciertos. Una bodega con 200 diferencias sobre 2.000 referencias lo está haciendo mejor que una con 50 sobre 100.',
  },
]

const LEYENDA = [
  { rotulo: 'Cuadró', color: COLOR.conciliado },
  { rotulo: 'Aclarada', color: COLOR.neutro },
  { rotulo: 'Faltante', color: COLOR.faltante },
  { rotulo: 'Sobrante', color: COLOR.sobrante },
  { rotulo: 'Sin resolver', color: COLOR.fantasma },
]

function Resumen() {
  const router = useRouter()
  const parametros = useSearchParams()
  const periodo = parametros.get('mes') ?? mesEnCursoEnBogota()

  const [orden, setOrden] = useState<Orden>('diferencias')

  const informe = m.useCarga(() => m.resumen(periodo), [periodo])
  const razones = m.useCarga(() => m.causas(periodo), [periodo])

  const bodegas = useMemo(() => ordenar(informe.datos?.bodegas ?? [], orden), [informe.datos, orden])

  return (
    <MarcoAdmin
      titulo="Resumen"
      subtitulo={`Comparativo de bodegas · ${m.nombreDeMes(periodo)}`}
      filtros={
        <Filtros
          periodo={periodo}
          bodega=""
          // El mes vive en la URL: esta pantalla se comparte por chat y un filtro
          // en memoria le abre otra cosa a quien recibe el enlace.
          alCambiarPeriodo={(v) => router.replace(`/admin?mes=${v}`, { scroll: false })}
          alCambiarBodega={() => undefined}
          ocultarBodega
        />
      }
    >
      <Estado
        cargando={informe.cargando}
        error={informe.error}
        vacio={informe.datos !== null && informe.datos.bodegas.length === 0}
        mensajeVacio={`Ninguna bodega tiene inventario cerrado ni en curso en ${m.nombreDeMes(periodo)}.`}
        alReintentar={informe.recargar}
      >
        {informe.datos && (
          <>
            <section className="mt-4 grid grid-cols-2 gap-2">
              <Cifra
                valor={m.numero(informe.datos.global.contadas)}
                rotulo="Referencias contadas"
                nota={`en ${m.numero(informe.datos.global.bodegas)} ${informe.datos.global.bodegas === 1 ? 'bodega' : 'bodegas'}`}
                icono={<Boxes className="h-3.5 w-3.5" />}
              />
              <Cifra
                valor={m.porcentaje(informe.datos.global.precision)}
                rotulo="Precisión"
                nota="contadas que cuadraron con el sistema"
                icono={<Target className="h-3.5 w-3.5" />}
              />
            </section>

            <NotaDeReferencias />
            <BloqueAjuste g={informe.datos.global} />
            <Composicion g={informe.datos.global} />

            <section className="mt-6">
              <h2 className="font-display text-sm font-bold text-foreground">Comparativo por bodega</h2>
              <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
                {ORDENES.find((o) => o.id === orden)?.explicacion}
              </p>

              <div className="mt-2 flex gap-2" role="group" aria-label="Orden del comparativo">
                {ORDENES.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setOrden(o.id)}
                    aria-pressed={orden === o.id}
                    className={cn(
                      'h-11 flex-1 rounded-lg border-2 px-2 font-display text-xs font-bold transition-colors',
                      orden === o.id
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input bg-card text-muted-foreground',
                    )}
                  >
                    {o.rotulo}
                  </button>
                ))}
              </div>

              <div className="mt-4">
                <BarrasApiladas
                  filas={bodegas.map((b) => ({
                    id: b.bodegaId,
                    rotulo: b.bodega,
                    tramos: tramosDe(b),
                    total: b.contadas,
                    nota: `· ${m.porcentaje(b.precision, 0)}`,
                  }))}
                  leyenda={LEYENDA}
                  formato={m.numero}
                />
              </div>

              <ul className="mt-4 space-y-2">
                {bodegas.map((b) => (
                  <TarjetaBodega key={b.bodegaId} b={b} />
                ))}
              </ul>
            </section>

            <Causas periodo={periodo} razones={razones} />
          </>
        )}
      </Estado>
    </MarcoAdmin>
  )
}

/**
 * La aclaración que el cliente subrayó en la reunión.
 *
 * Va en pantalla y no en el manual porque el malentendido es caro: quien lea
 * "12 faltantes" y piense en unidades va a creer que la bodega perdió doce
 * cosas, cuando puede haber perdido trescientos panes de una sola referencia.
 */
function NotaDeReferencias() {
  return (
    <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-muted px-2.5 py-2 text-[11px] leading-tight text-muted-foreground">
      <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        Toda cantidad de esta pantalla son <strong className="font-semibold text-foreground">referencias</strong>, no
        unidades: 300 panes faltantes son <strong className="font-semibold text-foreground">una</strong> referencia con
        faltante, no 300.
      </span>
    </p>
  )
}

/**
 * El ajuste contable, con su letra pequeña delante.
 *
 * `valorAjuste` llega en `null` cuando NINGUNA referencia tiene costo cargado, y
 * hoy es el caso: el archivo del cliente (`bodegas-y-stock.xlsx`) no trae
 * precios. Pintar "$0" ahí diría que el mes cerró sin impacto contable, que es
 * exactamente lo contrario de la verdad —no se sabe cuánto fue—. Así que en ese
 * caso la cifra se sustituye por la cobertura de costos, que es el dato que de
 * verdad hay.
 */
function BloqueAjuste({ g }: { g: m.Resumen['global'] }) {
  const cubiertas = g.conCosto + g.sinCosto
  const ajuste = leerAjuste(g.valorAjuste)

  return (
    <section className="mt-3 rounded-xl border border-border bg-card p-3">
      <p className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
        <Coins className="h-3.5 w-3.5" aria-hidden />
        Ajuste contable del mes
      </p>

      <p className={cn('mt-1 font-display text-2xl font-extrabold leading-tight tabular-nums', ajuste.clase)}>
        {g.valorAjuste === null ? 'Sin costear' : m.pesos(g.valorAjuste)}
        {g.valorAjuste !== null && (
          <span className="ml-1.5 font-sans text-xs font-normal text-muted-foreground">{ajuste.nota}</span>
        )}
      </p>

      <p className="mt-1.5 text-[11px] leading-tight text-muted-foreground">
        {g.valorAjuste === null
          ? `El maestro de artículos no trae precios: ninguna de las ${m.numero(g.conDiferencia)} referencias con diferencia tiene costo cargado. El impacto del mes existe, pero por ahora se mide en referencias y no en pesos.`
          : g.sinCosto > 0
            ? `Cubre ${m.numero(g.conCosto)} de ${m.numero(cubiertas)} referencias con diferencia. Las ${m.numero(g.sinCosto)} restantes no tienen costo cargado, así que la cifra real es mayor que la de arriba.`
            : 'Todas las referencias con diferencia tienen costo cargado: la cifra está completa.'}
      </p>

      {cubiertas > 0 && (
        <div className="mt-3">
          <Proporcion
            parte={g.conCosto}
            total={cubiertas}
            color={COLOR.conciliado}
            rotulo="Referencias con diferencia que tienen costo"
          />
        </div>
      )}

      {g.valorAjuste !== null && (
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-2">
          <p className="text-[11px] text-muted-foreground">
            Faltantes
            <span className="mt-0.5 block font-display text-sm font-bold tabular-nums text-danger">
              {m.pesos(g.valorFaltantes)}
            </span>
          </p>
          <p className="text-[11px] text-muted-foreground">
            Sobrantes
            {/* Sin verde: un sobrante suma al balance pero sigue siendo un fallo
                de control, y pintarlo como un acierto lo premiaría. */}
            <span className="mt-0.5 block font-display text-sm font-bold tabular-nums text-foreground">
              {m.pesos(g.valorSobrantes)}
            </span>
          </p>
        </div>
      )}
    </section>
  )
}

/** En qué terminó cada referencia del mes, en proporción sobre el total en juego. */
function Composicion({ g }: { g: m.Resumen['global'] }) {
  // Las tres son disjuntas y cubren todo lo que el inventario tocó: lo que
  // alguien contó, lo que apareció sin existir en el ERP y lo que nadie miró.
  const universo = g.contadas + g.fantasmas + g.sinCobertura

  const filas = [
    { clave: 'cuadro', rotulo: 'Cuadraron sin novedad', parte: g.sinDiferencia, color: COLOR.conciliado },
    { clave: 'aclaradas', rotulo: 'Aclaradas por el Auditor', parte: g.aclaradas, color: COLOR.neutro },
    { clave: 'faltantes', rotulo: 'Con faltante real · merma', parte: g.faltantes, color: COLOR.faltante },
    { clave: 'sobrantes', rotulo: 'Con sobrante real', parte: g.sobrantes, color: COLOR.sobrante },
    { clave: 'fantasmas', rotulo: 'Fantasmas · en bodega, no en el ERP', parte: g.fantasmas, color: COLOR.fantasma },
    { clave: 'sinCobertura', rotulo: 'Sin cobertura · nadie las contó', parte: g.sinCobertura, color: COLOR.neutro },
  ]

  return (
    <section className="mt-6">
      <h2 className="font-display text-sm font-bold text-foreground">En qué terminó cada referencia</h2>
      <p className="mt-0.5 text-[11px] leading-tight tabular-nums text-muted-foreground">
        {m.numero(g.conDiferencia)} de {m.numero(g.contadas)} referencias contadas levantaron diferencia contra el
        sistema. Los porcentajes son sobre las {m.numero(universo)} referencias que el inventario tocó este mes.
      </p>

      <div className="mt-3 space-y-2.5">
        {filas.map((f) => (
          <Proporcion key={f.clave} parte={f.parte} total={universo} color={f.color} rotulo={f.rotulo} />
        ))}
      </div>

      {g.pendientes > 0 && (
        <p className="mt-3 rounded-lg bg-warning-soft px-2.5 py-2 text-[11px] leading-tight tabular-nums text-warning-foreground">
          {m.numero(g.pendientes)} referencias con diferencia siguen sin causa registrada. Un cierre avalado las deja en
          cero.
        </p>
      )}
    </section>
  )
}

/** Las cifras exactas que pidió el cliente, bodega por bodega. */
function TarjetaBodega({ b }: { b: m.KpiDeBodega }) {
  const ajuste = leerAjuste(b.valorAjuste)

  return (
    <li className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-semibold text-foreground">{b.bodega}</p>
        <Sello fuente={b.fuente} />
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2">
        <Dato valor={m.numero(b.contadas)} rotulo="Contadas" />
        <Dato valor={m.numero(b.sinDiferencia)} rotulo="Sin diferencia" tono="exito" />
        <Dato
          valor={m.numero(b.conDiferencia)}
          rotulo="Con diferencia"
          tono={b.conDiferencia > 0 ? 'peligro' : undefined}
        />
      </div>

      <div className="mt-2 flex items-baseline justify-between gap-2 border-t border-border pt-2">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Ajuste contable</span>
        <span className="shrink-0 text-right">
          <span className={cn('font-display text-sm font-bold tabular-nums', ajuste.clase)}>
            {b.valorAjuste === null ? 'Sin costear' : m.pesos(b.valorAjuste)}
          </span>
          <span className="ml-1 text-[11px] font-normal text-muted-foreground">{ajuste.nota}</span>
        </span>
      </div>

      <p className="mt-1.5 text-[11px] leading-tight tabular-nums text-muted-foreground">{desglose(b)}</p>
    </li>
  )
}

function Causas({
  periodo,
  razones,
}: {
  periodo: string
  razones: ReturnType<typeof m.useCarga<{ causas: { causa: string; descripcion: string; referencias: number; valorAjuste: number | null }[] }>>
}) {
  const lista = razones.datos?.causas ?? []
  const total = lista.reduce((a, c) => a + c.referencias, 0)

  return (
    <section className="mt-6">
      <h2 className="font-display text-sm font-bold text-foreground">Con qué causa se cerró cada diferencia</h2>
      <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
        El código de razón que registró el Auditor al resolverla, y cuántas referencias cerró con cada uno en{' '}
        {m.nombreDeMes(periodo)}.
      </p>

      <Estado
        cargando={razones.cargando}
        error={razones.error}
        vacio={razones.datos !== null && lista.length === 0}
        mensajeVacio="Todavía no se ha cerrado ninguna diferencia con causa este mes."
        alReintentar={razones.recargar}
      >
        <ul className="mt-3 space-y-3">
          {lista.map((c) => (
            <li key={c.causa}>
              {/* Un solo color: las causas no son faltante ni sobrante, y darles
                  la paleta de los hallazgos insinuaría una polaridad que no
                  tienen. El orden —lo trae el servidor— ya jerarquiza. */}
              <Proporcion parte={c.referencias} total={total} color={COLOR.neutro} rotulo={c.descripcion} />
              <p className="mt-0.5 flex items-baseline justify-between gap-2 text-[10px] text-muted-foreground">
                <span className="truncate uppercase tracking-wide">{c.causa}</span>
                {c.valorAjuste !== null && <span className="shrink-0 tabular-nums">{m.pesos(c.valorAjuste)}</span>}
              </p>
            </li>
          ))}
        </ul>
      </Estado>
    </section>
  )
}

function Dato({ valor, rotulo, tono }: { valor: string; rotulo: string; tono?: 'exito' | 'peligro' }) {
  return (
    <div>
      <p
        className={cn(
          'font-display text-base font-extrabold leading-none tabular-nums text-foreground',
          tono === 'exito' && 'text-success',
          tono === 'peligro' && 'text-danger',
        )}
      >
        {valor}
      </p>
      <p className="mt-0.5 text-[10px] uppercase leading-tight tracking-wide text-muted-foreground">{rotulo}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cálculos de presentación
// ---------------------------------------------------------------------------

/**
 * Los tramos de la barra de una bodega.
 *
 * El quinto —"sin resolver"— se deriva restando, y no se toma del `pendientes`
 * del servidor a propósito: ese contador incluye faltantes y sobrantes que
 * todavía no tienen código de razón, así que sumarlo daría más que `contadas` y
 * la barra dejaría de cuadrar consigo misma. La resta sí produce tramos
 * disjuntos, que es lo único que una barra apilada admite.
 *
 * El morado es el mismo de los fantasmas y significa lo mismo en las dos
 * figuras de esta pantalla: una anomalía que el ERP todavía no explica.
 */
function tramosDe(b: m.KpiDeBodega): Tramo[] {
  const conVeredicto = b.sinDiferencia + b.aclaradas + b.faltantes + b.sobrantes
  return [
    { clave: 'cuadro', rotulo: 'cuadraron', valor: b.sinDiferencia, color: COLOR.conciliado },
    { clave: 'aclaradas', rotulo: 'aclaradas', valor: b.aclaradas, color: COLOR.neutro },
    { clave: 'faltantes', rotulo: 'con faltante', valor: b.faltantes, color: COLOR.faltante },
    { clave: 'sobrantes', rotulo: 'con sobrante', valor: b.sobrantes, color: COLOR.sobrante },
    { clave: 'sinResolver', rotulo: 'sin resolver', valor: Math.max(0, b.contadas - conVeredicto), color: COLOR.fantasma },
  ]
}

function ordenar(bodegas: readonly m.KpiDeBodega[], orden: Orden): m.KpiDeBodega[] {
  return [...bodegas].sort((a, b) => {
    if (orden === 'precision') {
      // Una bodega sin nada contado no tiene mala precisión: no tiene ninguna.
      // El 2 la manda al final en vez de disputarle el primer puesto a la que sí
      // tiene un problema real.
      const pa = a.precision ?? 2
      const pb = b.precision ?? 2
      if (pa !== pb) return pa - pb
    } else {
      const da = a.conDiferencia + a.fantasmas
      const db = b.conDiferencia + b.fantasmas
      if (da !== db) return db - da
    }
    return a.bodega.localeCompare(b.bodega, 'es')
  })
}

function leerAjuste(valor: number | null): { nota: string; clase: string } {
  if (valor === null) return { nota: 'sin costos', clase: 'text-muted-foreground' }
  if (valor < 0) return { nota: 'en contra', clase: 'text-danger' }
  if (valor > 0) return { nota: 'a favor', clase: 'text-success' }
  return { nota: 'sin impacto', clase: 'text-foreground' }
}

function desglose(b: m.KpiDeBodega): string {
  const partes = [`Precisión ${m.porcentaje(b.precision)}`]
  if (b.faltantes > 0) partes.push(`${m.numero(b.faltantes)} con faltante`)
  if (b.sobrantes > 0) partes.push(`${m.numero(b.sobrantes)} con sobrante`)
  if (b.aclaradas > 0) partes.push(`${m.numero(b.aclaradas)} aclaradas`)
  if (b.fantasmas > 0) partes.push(`${m.numero(b.fantasmas)} fantasmas`)
  if (b.sinCobertura > 0) partes.push(`${m.numero(b.sinCobertura)} sin cobertura`)
  if (b.pendientes > 0) partes.push(`${m.numero(b.pendientes)} sin causa`)
  return partes.join(' · ')
}

/**
 * El mes por defecto del filtro, en hora de Bogotá.
 *
 * Se calcula igual que en el controlador: Colombia va cinco horas por detrás de
 * UTC, así que el último día del mes, entre las 19:00 y la medianoche locales,
 * la fecha UTC ya cambió de mes y el filtro abriría en un mes que aún no empieza.
 */
function mesEnCursoEnBogota(): string {
  const bogota = new Date(Date.now() - 5 * 60 * 60 * 1000)
  return `${bogota.getUTCFullYear()}-${String(bogota.getUTCMonth() + 1).padStart(2, '0')}`
}
