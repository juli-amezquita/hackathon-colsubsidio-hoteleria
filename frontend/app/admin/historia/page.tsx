'use client'

import { Search, TrendingUp } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Cifra, COLOR, Leyenda, Linea, RejillaDeMiniaturas, type PuntoSerie } from '@/components/admin/graficos'
import { Estado, MarcoAdmin } from '@/components/admin/marco'
import { RequireRole } from '@/components/require-role'
import { TextField } from '@/components/text-field'
import { Button } from '@/components/ui-button'
import * as m from '@/lib/metricas'
import { cn } from '@/lib/utils'

/**
 * El análisis histórico. Dos preguntas del cliente, en este orden:
 *
 *  1. «Ver de manera histórica (últimos 12 meses) la cantidad de ítems con
 *     diferencias de cada una de las bodegas, para comparar el resultado y la
 *     precisión con la que se hacen los inventarios.»
 *  2. «Analizar el comportamiento de un producto específico a lo largo del
 *     tiempo.»
 *
 * La primera se responde con una miniatura por bodega —todas a la misma escala
 * vertical— y no con ocho líneas superpuestas: en el móvil desde el que se abre
 * esta pantalla, ocho líneas cruzadas son un ovillo, y el ojo compara ocho
 * formas pequeñas mucho mejor que ocho trazos encimados. La línea grande queda
 * para la bodega que se toque.
 *
 * Y la regla que gobierna todo el archivo: **un mes sin datos no es un cero**.
 * `consolidado_historico` solo tiene los meses que el Auditor ya cerró; cuando
 * una bodega no se inventarió, el punto llega `null` y la línea se corta.
 * Pintarlo en cero diría que se contó y no había diferencias — exactamente lo
 * contrario de lo que pasó, y justo la lectura que llevaría a felicitar a la
 * bodega que no contó.
 */

// ---------------------------------------------------------------------------
// Qué se mide
// ---------------------------------------------------------------------------

type ClaveMetrica = 'conDiferencia' | 'faltantes' | 'sobrantes' | 'precision'

interface Metrica {
  rotulo: string
  color: string
  formato: (n: number) => string
  ayuda: string
}

/**
 * Un solo selector cambia la métrica de TODOS los gráficos de la pantalla.
 *
 * Cuatro medidas en un mismo gráfico con dos ejes verticales sería más compacto
 * y sería mentira: con un eje por magnitud, la escala decide la conclusión.
 * Aquí se ve una medida a la vez, en el mismo eje para todas las bodegas.
 */
const METRICA: Record<ClaveMetrica, Metrica> = {
  conDiferencia: {
    rotulo: 'Referencias con diferencia',
    // Gris a propósito: es la suma de faltantes y sobrantes, no tiene signo, y
    // teñirla de rojo o de azul le atribuiría uno.
    color: COLOR.neutro,
    formato: m.numero,
    ayuda: 'Referencias cuyo conteo no cuadró con el sistema.',
  },
  faltantes: {
    rotulo: 'Faltantes',
    color: COLOR.faltante,
    formato: m.numero,
    ayuda: 'Tras el Auditor sigue habiendo menos de lo que decía el sistema.',
  },
  sobrantes: {
    rotulo: 'Sobrantes',
    color: COLOR.sobrante,
    formato: m.numero,
    ayuda: 'Tras el Auditor sigue habiendo más de lo que decía el sistema.',
  },
  precision: {
    rotulo: 'Precisión',
    color: COLOR.conciliado,
    formato: (n) => m.porcentaje(n, 1),
    ayuda: 'Referencias que cuadraron a la primera sobre el total contado.',
  },
}

const ORDEN: ClaveMetrica[] = ['conDiferencia', 'faltantes', 'sobrantes', 'precision']

const MESES_VENTANA = 12

// ---------------------------------------------------------------------------

export default function PaginaHistorico() {
  return (
    <RequireRole role="admin">
      <Historico />
    </RequireRole>
  )
}

function Historico() {
  const [metrica, setMetrica] = useState<ClaveMetrica>('conDiferencia')
  const [bodegaId, setBodegaId] = useState<string | null>(null)

  const { datos, error, cargando, recargar } = m.useCarga(() => m.historia(MESES_VENTANA), [])
  const def = METRICA[metrica]

  // El eje temporal viene completo del servidor aunque no haya cierres: los
  // doce meses existen siempre, lo que falta son los puntos.
  const ejeX = useMemo(() => (datos?.meses ?? []).map(m.nombreDeMes), [datos])

  const miniaturas = useMemo(
    () =>
      (datos?.series ?? []).map((s) => ({
        id: s.bodegaId,
        rotulo: s.bodega,
        puntos: s.puntos.map((p) => p[metrica]),
      })),
    [datos, metrica],
  )

  const seleccionada = datos?.series.find((s) => s.bodegaId === bodegaId) ?? null

  return (
    <MarcoAdmin
      titulo="Histórico"
      subtitulo={`Últimos ${MESES_VENTANA} meses`}
      // No se usa el selector de mes del tablero: esta pantalla no mira un mes,
      // mira una ventana de doce. Un control que no cambia nada de lo que se ve
      // es peor que no tenerlo.
      filtros={
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Qué se mide
          </span>
          <select
            value={metrica}
            onChange={(e) => setMetrica(e.target.value as ClaveMetrica)}
            disabled={miniaturas.length === 0}
            className="h-11 w-full rounded-lg border-2 border-input bg-card px-2 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            {ORDEN.map((k) => (
              <option key={k} value={k}>
                {METRICA[k].rotulo}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] leading-tight text-muted-foreground">{def.ayuda}</span>
        </label>
      }
    >
      <section aria-labelledby="comparativa">
        <h2 id="comparativa" className="mt-5 font-display text-base font-extrabold text-foreground">
          Comparativa entre bodegas
        </h2>

        <Estado
          cargando={cargando}
          error={error}
          vacio={miniaturas.length === 0 || ejeX.length === 0}
          mensajeVacio={
            'Todavía no hay ningún mes cerrado. El histórico se construye con cada cierre: ' +
            'cuando el Auditor avale el inventario de una bodega, ese mes queda escrito y ' +
            'aparecerá aquí junto al de las demás. No falta nada — falta el primer cierre.'
          }
          alReintentar={recargar}
        >
          <p className="mt-1 text-xs leading-snug text-muted-foreground">
            Una bodega por recuadro, todas dibujadas con la misma escala vertical. Toca una para ver su serie
            completa.
          </p>

          <div className="mt-3">
            <RejillaDeMiniaturas
              series={miniaturas}
              meses={ejeX}
              formato={def.formato}
              alSeleccionar={(id) => setBodegaId((previa) => (previa === id ? null : id))}
            />
          </div>

          <div className="mt-3 rounded-xl border border-border bg-card p-3">
            <Leyenda entradas={[{ rotulo: def.rotulo, color: def.color }]} />
            <p className="mt-1.5 text-[11px] leading-tight text-muted-foreground">
              La línea se corta en los meses en que la bodega no se inventarió. Un hueco no es un cero: un cero
              diría que se contó y no había diferencias.
            </p>
          </div>

          {seleccionada ? (
            <DetalleDeBodega serie={seleccionada} metrica={metrica} def={def} />
          ) : (
            <p className="mt-4 flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-4 text-center text-xs text-muted-foreground">
              <TrendingUp className="h-3.5 w-3.5 shrink-0" />
              Toca una bodega para dibujar sus {MESES_VENTANA} meses.
            </p>
          )}
        </Estado>
      </section>

      <Producto />
    </MarcoAdmin>
  )
}

// ---------------------------------------------------------------------------
// Una bodega, doce meses
// ---------------------------------------------------------------------------

function DetalleDeBodega({
  serie,
  metrica,
  def,
}: {
  serie: m.Historia['series'][number]
  metrica: ClaveMetrica
  def: Metrica
}) {
  const valores = serie.puntos.map((p) => p[metrica])
  const conDato = valores.filter((v): v is number => v !== null)
  const ultimo = conDato.length > 0 ? conDato[conDato.length - 1] : null
  const promedio = conDato.length > 0 ? conDato.reduce((a, b) => a + b, 0) / conDato.length : null
  const huecos = valores.length - conDato.length

  // El rótulo del eje sale del propio punto y no de un arreglo paralelo: así no
  // hay forma de que la etiqueta y el valor se desfasen.
  const puntos: PuntoSerie[] = serie.puntos.map((p) => ({ x: m.nombreDeMes(p.periodo), y: p[metrica] }))

  return (
    <section className="mt-5" aria-labelledby="serie-bodega">
      <h3 id="serie-bodega" className="font-display text-base font-extrabold text-foreground">
        {serie.bodega}
      </h3>
      <p className="text-xs text-muted-foreground">{def.rotulo}</p>

      <div className="mt-2 rounded-xl border border-border bg-card p-3">
        <Linea puntos={puntos} color={def.color} formato={def.formato} rotuloY={`${serie.bodega} · ${def.rotulo}`} />
      </div>

      {/* Las cifras van sin color: "alto" es malo en faltantes y bueno en
          precisión, así que teñirlas todas con la misma regla mentiría en la
          mitad de los casos. Los huecos sí llevan aviso: no haber inventariado
          es siempre lo mismo. */}
      <div className="mt-2 grid grid-cols-3 gap-2">
        <Cifra valor={ultimo === null ? '—' : def.formato(ultimo)} rotulo="Último cierre" />
        <Cifra
          valor={promedio === null ? '—' : def.formato(promedio)}
          rotulo="Promedio"
          nota="solo meses cerrados"
        />
        <Cifra
          valor={m.numero(huecos)}
          rotulo="Sin inventariar"
          nota={`de ${valores.length} meses`}
          tono={huecos > 0 ? 'aviso' : 'exito'}
        />
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Un producto a lo largo del tiempo
// ---------------------------------------------------------------------------

type Articulo = Awaited<ReturnType<typeof m.articulo>>
type PuntoArticulo = Articulo['puntos'][number]
type TipoDeClave = 'codigo' | 'nombre'

/** `numeric(14,3)` viaja como cadena para no perder decimales en el JSON. */
function aNumero(v: string | null): number | null {
  if (v === null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Se reusa el formateador de cantidades del cliente en vez de escribir otro. */
const formatoCantidad = (n: number) => m.cantidad(String(n))

function Producto() {
  const [tipo, setTipo] = useState<TipoDeClave>('codigo')
  const [texto, setTexto] = useState('')
  const [consulta, setConsulta] = useState<{ tipo: TipoDeClave; valor: string } | null>(null)

  // La búsqueda se dispara al enviar y no al teclear: el servidor compara por
  // igualdad exacta, así que cada letra intermedia sería una consulta que no
  // puede encontrar nada.
  const { datos, error, cargando } = m.useCarga<Articulo | null>(
    () =>
      consulta
        ? m.articulo(consulta.tipo === 'codigo' ? { codigo: consulta.valor } : { nombre: consulta.valor })
        : Promise.resolve(null),
    [consulta],
  )

  /**
   * El mismo producto es una fila distinta en cada bodega, así viene el archivo
   * del cliente. Se agrupa por bodega y se tiende un eje con los meses en que
   * el producto aparece en algún cierre; el mes que le falte a una bodega queda
   * `null` y su línea se corta, igual que arriba.
   */
  const grupos = useMemo(() => {
    if (!datos || datos.puntos.length === 0) return null

    const meses = [...new Set(datos.puntos.map((p) => p.periodo))].sort()
    const porBodega = new Map<string, Map<string, PuntoArticulo>>()
    for (const p of datos.puntos) {
      const fila = porBodega.get(p.bodega) ?? new Map<string, PuntoArticulo>()
      fila.set(p.periodo, p)
      porBodega.set(p.bodega, fila)
    }

    return {
      meses,
      bodegas: [...porBodega.entries()]
        .map(([bodega, filas]) => ({ bodega, meses: meses.map((mes) => ({ mes, punto: filas.get(mes) ?? null })) }))
        .sort((a, b) => a.bodega.localeCompare(b.bodega, 'es')),
    }
  }, [datos])

  return (
    <section className="mt-8 border-t border-border pt-5" aria-labelledby="producto">
      <h2 id="producto" className="font-display text-base font-extrabold text-foreground">
        Un producto en el tiempo
      </h2>
      <p className="mt-1 text-xs leading-snug text-muted-foreground">
        Cómo se ha comportado la diferencia de una referencia, mes a mes y bodega por bodega.
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Buscar el producto por">
        {(['codigo', 'nombre'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTipo(t)}
            aria-pressed={tipo === t}
            className={cn(
              'h-11 rounded-lg border-2 font-display text-sm font-bold transition-colors',
              tipo === t ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card text-foreground',
            )}
          >
            {t === 'codigo' ? 'Por código' : 'Por nombre'}
          </button>
        ))}
      </div>

      <form
        className="mt-3"
        onSubmit={(e) => {
          e.preventDefault()
          const valor = texto.trim()
          if (valor) setConsulta({ tipo, valor })
        }}
      >
        <TextField
          label={tipo === 'codigo' ? 'Código del producto' : 'Nombre del producto'}
          placeholder={tipo === 'codigo' ? 'Ej. 1002478' : 'Ej. ACEITE VEGETAL X 20 LT'}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          icon={<Search className="h-4 w-4" />}
          helper="Coincidencia exacta. Solo se consultan los meses ya cerrados."
          autoComplete="off"
          enterKeyHint="search"
        />
        <Button type="submit" size="block" disabled={!texto.trim()}>
          Buscar
        </Button>
      </form>

      {consulta && (
        <Estado
          cargando={cargando}
          error={error}
          vacio={grupos === null}
          mensajeVacio={`Ningún cierre registra ${consulta.tipo === 'codigo' ? 'el código' : 'el nombre'} «${consulta.valor}». La búsqueda es exacta y el histórico solo contiene los meses ya avalados.`}
        >
          {grupos && (
            <div className="mt-4">
              <p className="font-display text-sm font-extrabold leading-tight text-foreground">
                {datos?.nombre ?? consulta.valor}
              </p>
              <p className="text-xs text-muted-foreground">
                {datos?.unidad ? `${datos.unidad} · ` : ''}
                {grupos.bodegas.length} {grupos.bodegas.length === 1 ? 'bodega' : 'bodegas'} ·{' '}
                {grupos.meses.length} {grupos.meses.length === 1 ? 'mes cerrado' : 'meses cerrados'}
              </p>

              <div className="mt-3 space-y-4">
                {grupos.bodegas.map((b) => (
                  <ProductoEnBodega key={b.bodega} bodega={b.bodega} meses={b.meses} />
                ))}
              </div>
            </div>
          )}
        </Estado>
      )}
    </section>
  )
}

function ProductoEnBodega({
  bodega,
  meses,
}: {
  bodega: string
  meses: { mes: string; punto: PuntoArticulo | null }[]
}) {
  const puntos: PuntoSerie[] = meses.map((f) => ({
    x: m.nombreDeMes(f.mes),
    y: f.punto ? aNumero(f.punto.diferencia) : null,
  }))

  // El color lo fija el signo de la última diferencia conocida, que es la que
  // describe el estado actual del producto en esa bodega. Sin dato conocido no
  // se pinta ni de rojo ni de azul: no se sabe.
  const ultima = [...puntos].reverse().find((p) => p.y !== null)?.y ?? null
  const color =
    ultima === null ? COLOR.neutro : ultima < 0 ? COLOR.faltante : ultima > 0 ? COLOR.sobrante : COLOR.conciliado

  return (
    <article className="rounded-xl border border-border bg-card p-3">
      <h3 className="truncate text-xs font-semibold text-foreground">{bodega}</h3>

      <Linea puntos={puntos} color={color} formato={formatoCantidad} rotuloY={`Diferencia en ${bodega}`} />

      <Leyenda entradas={[{ rotulo: 'Diferencia (físico − sistema)', color }]} />

      {/* La tabla no es un extra: el gráfico enseña la forma de la diferencia y
          la tabla enseña las tres cantidades con las que se calculó. Además es
          lo único que lee un lector de pantalla. */}
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-[11px] tabular-nums">
          <caption className="sr-only">Cantidad física, cantidad del sistema y diferencia por mes en {bodega}</caption>
          <thead>
            <tr className="text-left text-muted-foreground">
              <th scope="col" className="py-1 pr-2 font-semibold">
                Mes
              </th>
              <th scope="col" className="py-1 pr-2 text-right font-semibold">
                Físico
              </th>
              <th scope="col" className="py-1 pr-2 text-right font-semibold">
                Sistema
              </th>
              <th scope="col" className="py-1 text-right font-semibold">
                Diferencia
              </th>
            </tr>
          </thead>
          <tbody>
            {meses.map((f) => {
              const diferencia = f.punto ? aNumero(f.punto.diferencia) : null
              return (
                <tr key={f.mes} className="border-t border-border">
                  <th scope="row" className="py-1 pr-2 text-left font-normal text-muted-foreground">
                    {m.nombreDeMes(f.mes)}
                  </th>
                  {f.punto === null ? (
                    <td colSpan={3} className="py-1 text-right italic text-muted-foreground">
                      sin inventariar
                    </td>
                  ) : (
                    <>
                      <td className="py-1 pr-2 text-right text-foreground">{m.cantidad(f.punto.cantidadFisica)}</td>
                      <td className="py-1 pr-2 text-right text-muted-foreground">
                        {m.cantidad(f.punto.cantidadSistema)}
                      </td>
                      <td
                        className={cn(
                          'py-1 text-right font-semibold text-foreground',
                          diferencia !== null && diferencia < 0 && 'text-danger',
                          diferencia !== null && diferencia > 0 && 'text-warning-foreground',
                          diferencia === 0 && 'text-success',
                        )}
                      >
                        {m.cantidad(f.punto.diferencia)}
                      </td>
                    </>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </article>
  )
}
