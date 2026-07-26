'use client'

import { Ghost, Loader2, Search } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'

import { COLOR } from '@/components/admin/graficos'
import { Estado, Filtros, MarcoAdmin } from '@/components/admin/marco'
import { RequireRole } from '@/components/require-role'
import { TextField } from '@/components/text-field'
import * as m from '@/lib/metricas'
import { cn } from '@/lib/utils'

/**
 * BLOQUE 2 · El reporte detallado: una fila por referencia.
 *
 * Es la pantalla que pidió el cliente palabra por palabra —código, nombre,
 * unidad, cantidad física, cantidad del sistema, diferencia neta y estado de
 * validación—, y la única del tablero donde se mira artículo por artículo en
 * vez de bodega por bodega.
 *
 * Dos decisiones mandan sobre todo lo demás:
 *
 *  · **Se pagina de verdad.** El catálogo del cliente trae 1.421 artículos en
 *    ocho hojas y van 48 bodegas. Traerlo entero funciona hoy y deja de
 *    funcionar exactamente el mes en que el sistema empiece a servir.
 *  · **Un dato que falta no se rellena.** Una diferencia nula se pinta "—" y
 *    nunca 0: el cero afirma "cuadra", que es otra cosa y a veces mentira.
 */

export default function PaginaDetalle() {
  return (
    <RequireRole role="admin">
      {/* `useSearchParams` exige un límite de Suspense para que la ruta se
          pueda prerenderizar; hasta que resuelve se enseña el mismo "cargando"
          que el resto del tablero. */}
      <Suspense
        fallback={
          <MarcoAdmin titulo="Reporte detallado" subtitulo="Artículo por artículo">
            <Estado cargando error={null}>{null}</Estado>
          </MarcoAdmin>
        }
      >
        <Detalle />
      </Suspense>
    </RequireRole>
  )
}

/** Cuántas filas por página. Coincide con el tope por defecto del servidor. */
const PAGINA = 50

const ESTADOS: { valor: string; rotulo: string }[] = [
  { valor: '', rotulo: 'Todo' },
  { valor: 'diferencia', rotulo: 'Con diferencia' },
  { valor: 'faltante', rotulo: 'Faltantes' },
  { valor: 'sobrante', rotulo: 'Sobrantes' },
  { valor: 'fantasma', rotulo: 'Sin catálogo' },
  { valor: 'sin_cobertura', rotulo: 'Nadie lo contó' },
]

function Detalle() {
  const router = useRouter()
  const ruta = usePathname()
  const parametros = useSearchParams()

  // Los filtros se siembran desde la URL una sola vez y a partir de ahí viven
  // en React. La URL se reescribe después (efecto de abajo) para que el enlace
  // se pueda compartir por chat, que es como circula este tablero.
  const [periodo, setPeriodo] = useState(() => parametros.get('mes') ?? mesEnBogota())
  const [bodega, setBodega] = useState(() => parametros.get('bodega') ?? '')
  const [estado, setEstado] = useState(() => parametros.get('estado') ?? '')
  const [texto, setTexto] = useState(() => parametros.get('q') ?? '')
  const [q, setQ] = useState(texto)

  const [desde, setDesde] = useState(0)
  const [acumulado, setAcumulado] = useState<m.FilaDetalle[]>([])

  /**
   * Cualquier cambio de filtro vacía la lista y vuelve a la primera página.
   *
   * Dejar las filas anteriores mientras llega la nueva consulta insinúa que ya
   * son el resultado del filtro que se acaba de tocar; y seguir en la página 4
   * de otra búsqueda enseña un tramo de datos que nadie pidió.
   */
  const reiniciar = useCallback(() => {
    setDesde(0)
    setAcumulado([])
  }, [])

  // La búsqueda espera 300 ms. Sin el retardo, cada tecla es un LIKE sobre la
  // tabla del histórico: escribir "aceite" son seis consultas de las que cinco
  // ya no le importan a nadie cuando responden.
  useEffect(() => {
    // La guarda no es cosmética: sin ella el temporizador también corre al
    // montar y, 300 ms después, borraría la primera página ya cargada sin
    // pedir otra —los filtros no cambiaron— dejando la lista vacía para siempre.
    if (texto === q) return
    const t = setTimeout(() => {
      setQ(texto)
      reiniciar()
    }, 300)
    return () => clearTimeout(t)
  }, [texto, q, reiniciar])

  useEffect(() => {
    const p = new URLSearchParams({ mes: periodo })
    if (bodega) p.set('bodega', bodega)
    if (estado) p.set('estado', estado)
    if (q) p.set('q', q)
    router.replace(`${ruta}?${p}`, { scroll: false })
  }, [periodo, bodega, estado, q, ruta, router])

  // El `desde` viaja de vuelta con la respuesta: así se sabe si lo que llegó es
  // una página nueva que se pega al final o la primera, que reemplaza.
  const { datos, error, cargando, recargar } = m.useCarga(
    () =>
      m.detalle({ periodo, bodega, estado, q, limite: PAGINA, desde }).then((r) => ({ ...r, desde })),
    [periodo, bodega, estado, q, desde],
  )

  const pegado = useRef<object | null>(null)
  useEffect(() => {
    if (!datos || pegado.current === datos) return
    pegado.current = datos
    setAcumulado((previo) => (datos.desde === 0 ? datos.items : [...previo, ...datos.items]))
  }, [datos])

  const total = datos?.total ?? 0
  const vacio = acumulado.length === 0
  const faltan = Math.max(0, total - acumulado.length)

  return (
    <MarcoAdmin
      titulo="Reporte detallado"
      subtitulo={`Artículo por artículo · ${m.nombreDeMes(periodo)}`}
      filtros={
        <div className="space-y-2">
          <Filtros
            periodo={periodo}
            bodega={bodega}
            alCambiarPeriodo={(v) => {
              setPeriodo(v)
              reiniciar()
            }}
            alCambiarBodega={(v) => {
              setBodega(v)
              reiniciar()
            }}
          />

          {/* El desplazamiento horizontal se queda dentro de esta lista: si se
              lo comiera el `body`, la pantalla entera se movería de lado. */}
          <ul className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
            {ESTADOS.map((e) => {
              const activo = estado === e.valor
              return (
                <li key={e.valor || 'todo'}>
                  <button
                    type="button"
                    aria-pressed={activo}
                    onClick={() => {
                      setEstado(e.valor)
                      reiniciar()
                    }}
                    className={cn(
                      'h-11 whitespace-nowrap rounded-lg border-2 px-3 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      activo
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input bg-card text-muted-foreground',
                    )}
                  >
                    {e.rotulo}
                  </button>
                </li>
              )
            })}
          </ul>

          <TextField
            label="Buscar artículo"
            placeholder="Nombre o código"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            icon={<Search className="h-4 w-4" />}
            trailing={
              texto !== q ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : undefined
            }
            autoComplete="off"
            inputMode="search"
          />
        </div>
      }
    >
      {/* El error se pinta siempre y se lleva la lista por delante: media lista
          sin aviso es peor que un aviso. `Reintentar` la devuelve intacta. */}
      <Estado
        cargando={cargando && vacio}
        error={error}
        vacio={vacio}
        mensajeVacio={`Ningún artículo cumple estos filtros en ${m.nombreDeMes(periodo)}.`}
        alReintentar={recargar}
      >
        <p className="py-3 text-xs text-muted-foreground">
          <span className="font-display font-bold tabular-nums text-foreground">
            {m.numero(acumulado.length)}
          </span>{' '}
          de <span className="tabular-nums">{m.numero(total)}</span>{' '}
          {total === 1 ? 'artículo' : 'artículos'}
        </p>

        <ul className="space-y-1.5">
          {acumulado.map((f, i) => (
            <Fila key={`${i}-${f.bodega}-${f.codigo ?? f.nombre}`} fila={f} />
          ))}
        </ul>

        {faltan > 0 && (
          <button
            type="button"
            onClick={() => setDesde(acumulado.length)}
            disabled={cargando}
            className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-lg border-2 border-input bg-card font-display text-sm font-bold text-foreground disabled:opacity-60"
          >
            {cargando && <Loader2 className="h-4 w-4 animate-spin" />}
            {cargando ? 'Cargando…' : `Cargar ${m.numero(Math.min(PAGINA, faltan))} más`}
          </button>
        )}
      </Estado>
    </MarcoAdmin>
  )
}

// ---------------------------------------------------------------------------
// La fila
// ---------------------------------------------------------------------------

/**
 * Una tarjeta por artículo, no una tabla.
 *
 * Siete columnas no caben en un móvil, y la tabla con desplazamiento lateral
 * esconde justo la columna que importa —la diferencia— detrás de un gesto que
 * nadie hace en una bodega con el teléfono en una mano.
 */
function Fila({ fila }: { fila: m.FilaDetalle }) {
  const diferencia = fila.diferencia === null ? null : Number(fila.diferencia)
  const desconocida = diferencia === null || !Number.isFinite(diferencia)

  return (
    <li
      className="rounded-xl border-2 border-border bg-card p-3"
      // El hallazgo sin catálogo se marca en el borde entero: es un artículo que
      // el ERP no conoce, y eso cambia cómo se lee todo lo demás de la tarjeta.
      style={fila.esFantasma ? { borderColor: COLOR.fantasma } : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-snug text-foreground">{fila.nombre}</p>
          <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
            <span className="tabular-nums">{fila.codigo ?? 'Sin código'}</span> · {fila.unidad} ·{' '}
            {fila.bodega}
          </p>
        </div>
        {fila.esFantasma && (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
            style={{ color: COLOR.fantasma, borderColor: COLOR.fantasma }}
          >
            <Ghost className="h-3 w-3" />
            Sin catálogo
          </span>
        )}
      </div>

      <dl className="mt-2 grid grid-cols-3 gap-1 rounded-lg bg-muted/60 p-2 text-center">
        <Celda rotulo="Física" valor={m.cantidad(fila.cantidadFisica)} />
        <Celda
          rotulo="Sistema"
          valor={m.cantidad(fila.cantidadSistema)}
          // Un fantasma no tiene saldo esperado por definición, no es un dato
          // perdido: se dice cuál de las dos cosas es.
          nota={fila.esFantasma ? 'no existe en el ERP' : undefined}
        />
        <Celda
          rotulo="Diferencia"
          valor={conSigno(fila.diferencia)}
          // El cero va en el color del texto normal: cuadrar es un resultado, no
          // un dato apagado. El gris de `COLOR.neutro` es para trazos, no para
          // cifras que hay que leer.
          color={desconocida ? undefined : diferencia < 0 ? COLOR.faltante : diferencia > 0 ? COLOR.sobrante : undefined}
        />
      </dl>

      {desconocida && (
        <p className="mt-1.5 text-[11px] leading-tight text-muted-foreground">
          Falta una de las dos cifras: la diferencia no se puede calcular.
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-tight">
        <span
          className={cn(
            'rounded-full px-2 py-0.5 font-bold uppercase tracking-wide',
            fila.clasificacion === 'conciliado'
              ? 'bg-success-soft text-success'
              : 'bg-warning-soft text-warning-foreground',
          )}
        >
          {VALIDACION[fila.clasificacion] ?? fila.clasificacion.replace(/_/g, ' ')}
        </span>

        <span className="text-muted-foreground">{leerMotivo(fila.motivo)}</span>

        {/* El código de razón se enseña crudo: el catálogo lo define el negocio
            y traducirlo aquí sería ponerle palabras que nadie ha aprobado. */}
        {fila.codigoRazon && (
          <span className="text-muted-foreground">
            Causa: <span className="font-semibold text-foreground">{fila.codigoRazon}</span>
          </span>
        )}

        {fila.valorAjuste !== null && (
          <span className="text-muted-foreground">
            Ajuste:{' '}
            <span className="font-display font-bold tabular-nums text-foreground">
              {m.pesos(fila.valorAjuste)}
            </span>
          </span>
        )}
      </div>
    </li>
  )
}

function Celda({
  rotulo,
  valor,
  nota,
  color,
}: {
  rotulo: string
  valor: string
  nota?: string
  color?: string
}) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{rotulo}</dt>
      <dd
        className="font-display text-sm font-extrabold leading-tight tabular-nums text-foreground"
        style={color ? { color } : undefined}
      >
        {valor}
      </dd>
      {nota && <dd className="text-[10px] leading-tight text-muted-foreground">{nota}</dd>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Vocabulario
// ---------------------------------------------------------------------------

const VALIDACION: Record<string, string> = {
  conciliado: 'Conciliado',
  auditable: 'Auditable',
}

/**
 * Los motivos, en castellano.
 *
 * El catálogo se repite aquí en vez de importarse del módulo del Auditor
 * porque los dos no coinciden: la consolidación emite `contradiccion_entre_rondas`
 * y `sin_saldo_esperado`, que allí no están. Si aparece uno nuevo se muestra
 * crudo y legible antes que traducido a la fuerza.
 */
const MOTIVO: Record<string, string> = {
  sin_cobertura: 'Nadie lo contó',
  discrepancia: 'No cuadra con el sistema',
  contradiccion_entre_rondas: 'Las rondas no coinciden',
  conflicto_entre_rondas: 'Las rondas no coinciden',
  sin_saldo_esperado: 'El sistema no tenía saldo',
  producto_fantasma: 'Hallazgo sin catálogo',
  resolucion_discrepante: 'El nombre se resolvió distinto',
  unidad_incorrecta: 'Unidad distinta a la esperada',
}

function leerMotivo(motivo: string | null): string {
  if (!motivo) return 'Sin observaciones'
  return MOTIVO[motivo] ?? motivo.replace(/_/g, ' ')
}

/** La diferencia con su signo. El `+` es explícito: "12" y "+12" no se leen igual. */
function conSigno(valor: string | null): string {
  if (valor === null) return '—'
  const n = Number(valor)
  if (!Number.isFinite(n)) return valor
  return `${n > 0 ? '+' : ''}${m.cantidad(valor)}`
}

/**
 * El mes en curso en Bogotá.
 *
 * Se calcula igual que en el servidor y no con `getMonth()` del navegador: un
 * portátil en otra zona horaria abriría el tablero en un mes distinto al que el
 * backend considera "el actual", y el selector se quedaría sin opción válida.
 */
function mesEnBogota(): string {
  const bogota = new Date(Date.now() - 5 * 60 * 60 * 1000)
  return `${bogota.getUTCFullYear()}-${String(bogota.getUTCMonth() + 1).padStart(2, '0')}`
}
