'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { ArticuloDeTrabajo } from '@cci/contracts'
import { normalizar } from '@cci/gramatica'

import * as api from '@/lib/api'
import {
  UNIDAD_DEL_SERVIDOR,
  rolDesdeServidor,
  unidadDesdeServidor,
  type Role,
  type Unit,
  type Warehouse,
} from '@/lib/data'

/**
 * El estado del conteo, contra el backend real.
 *
 * La interfaz pública es la misma que tenía la versión con datos falsos —
 * `login`, `selectWarehouse`, `addEntry`, `submitCount`, `reviewItem`— para
 * que las pantallas no cambien. Lo que cambia es de dónde salen los datos.
 *
 * ## Lo primero que se escribe es el disco, no la red (F-18, Restricción 2)
 *
 * Un conteo se guarda en el dispositivo y se le confirma al operario ANTES de
 * intentar enviarlo. La clave de idempotencia se genera aquí, en el
 * dispositivo, y el envío es un reintento contra esa cola. Si el Wi-Fi de la
 * bodega falla —y falla— no se pierde nada y nada se duplica: el servidor
 * deduplica por esa clave.
 *
 * El matiz que decide si esto sirve: la confirmación local dice *"quedó
 * registrado"*, **no** *"el sistema validó tu conteo"*. La alerta de
 * discrepancia la decide el servidor y llega después. Por eso cada entrada
 * lleva su `estadoEnvio` y su `validacion` por separado.
 */

export type EstadoEnvio = 'pendiente' | 'enviado' | 'rechazado'

export interface CountEntry {
  id: string
  /** Clave de idempotencia. Se genera ANTES del envío y no cambia jamás. */
  clave: string
  articuloId: string
  name: string
  quantity: number
  unit: Unit
  /**
   * El id de esa misma unidad en el catálogo del servidor.
   *
   * Se resuelve **al capturar**, no al enviar, porque al capturar el catálogo
   * está en memoria y al enviar puede no estarlo —la cola drena bodegas que ya
   * no son la activa—. Va aparte de `unit` y no se deriva de ella en el envío:
   * mandar siempre la unidad que el artículo espera haría que la alerta de
   * unidad equivocada (FR-2.1) no pudiera dispararse nunca.
   */
  unidadId: string
  order: number
  capturedAt: string
  /** Cantidad marcada como inusual y confirmada por el afiliado. */
  isAnomaly: boolean
  /** El afiliado confirmó volver a contar un artículo que ya había contado. */
  isDuplicate: boolean
  /** No se resolvió el nombre solo y el afiliado eligió de la lista. */
  needsReview: boolean
  transcript: string
  /** Id del clip de audio en IndexedDB (si se grabó por voz). */
  audioId?: string

  // ── Lo que responde el servidor ──────────────────────────────────────────
  estadoEnvio: EstadoEnvio
  /** `null` mientras no haya llegado el acuse: guardado ≠ validado (FR-6.5). */
  validacion: string | null
  /** El operario ya respondió a la alerta de este registro (FR-2.4). */
  alertaRespondida?: boolean
  registroId?: string
  error?: string
}

export type ReviewStatus = 'pendiente' | 'aprobado' | 'corregido'

export interface Review {
  status: ReviewStatus
  auditorQuantity: number
  auditorUnit: Unit
  note: string
  /** Del catálogo controlado. Sin causa no se cierra nada (R4, FR-4.4). */
  codigoRazonId?: string
}

export interface WarehouseCount {
  rondaId: string | null
  entries: CountEntry[]
  reviews: Record<string, Review>
  submitted: boolean
  updatedAt: string
}

interface Session {
  username: string
  role: Role
  name: string
}

interface CountState {
  session: Session | null
  warehouses_disponibles: Warehouse[]
  activeWarehouseId: string | null
  warehouses: Record<string, WarehouseCount>
}

interface CountContextValue extends CountState {
  ready: boolean
  active: WarehouseCount | null
  /** El catálogo de la bodega abierta. Cacheado para resolver sin red (F-21b). */
  catalogo: ArticuloDeTrabajo[]
  /** Cuántos conteos esperan a que vuelva la red. */
  pendientes: number
  error: string | null

  getWarehouse: (id: string | null | undefined) => Warehouse | null
  login: (username: string, password: string) => Promise<Session | null>
  logout: () => Promise<void>
  selectWarehouse: (id: string) => Promise<void>
  /** Resuelve un nombre dictado contra el catálogo cacheado. Sin red. */
  resolver: (texto: string) => { articulo: ArticuloDeTrabajo | null; candidatos: ArticuloDeTrabajo[] }
  addEntry: (entry: Omit<CountEntry, 'id' | 'clave' | 'order' | 'capturedAt' | 'estadoEnvio' | 'validacion'>) => void
  /** El id de una unidad en el catálogo de la bodega abierta. `null` si esa bodega no la maneja. */
  idDeUnidad: (u: Unit) => string | null
  updateEntry: (id: string, patch: Partial<Omit<CountEntry, 'id' | 'order'>>) => void
  removeEntry: (id: string) => void
  /** Hallazgo físico sin correspondencia en el catálogo (Historia 5, FR-5.x). */
  reportarHallazgo: (h: { nombre: string; cantidad: number; unidad: string | null }) => Promise<void>
  /**
   * Alertas que el servidor devolvió y el operario todavía no respondió.
   *
   * Son las que bloquean el cierre. Antes no se exponían y el resultado era el
   * peor posible: la pantalla decía "sin alertas", el botón de enviar no hacía
   * nada, y el motivo estaba en un `error` que ninguna pantalla pintaba.
   */
  alertasSinResponder: CountEntry[]
  /** El operario sostiene su conteo pese a la alerta (FR-2.4). */
  sostenerConteo: (entryId: string) => void
  submitCount: () => Promise<void>
  reopenCount: () => void
  reviewItem: (warehouseId: string, entryId: string, review: Review) => Promise<void>
  clearWarehouse: (id: string) => void
}

const STORAGE_KEY = 'cci-conteo-v3'

const CountContext = createContext<CountContextValue | null>(null)

const initialState: CountState = {
  session: null,
  warehouses_disponibles: [],
  activeWarehouseId: null,
  warehouses: {},
}

const vacia = (): WarehouseCount => ({
  rondaId: null,
  entries: [],
  reviews: {},
  submitted: false,
  updatedAt: new Date().toISOString(),
})

const genId = () => `e_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`

export function CountProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CountState>(initialState)
  const [catalogo, setCatalogo] = useState<ArticuloDeTrabajo[]>([])
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const drenando = useRef(false)

  // ── Persistencia local: lo primero que se escribe ────────────────────────

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) setState({ ...initialState, ...JSON.parse(raw) })
    } catch {
      // Estado corrupto: se arranca limpio en vez de romper la pantalla.
    }
    // La sesión vive en una cookie HttpOnly: el servidor es quien dice si
    // sigue viva, no el localStorage.
    api
      .sesionActual()
      .then((s) =>
        setState((prev) => ({
          ...prev,
          session: { username: s.usuarioId, role: rolDesdeServidor(s.rol), name: s.nombre },
          warehouses_disponibles: s.bodegas.map((b) => ({ id: b.id, name: b.nombre })),
        })),
      )
      .catch(() => {
        /* sin sesión: la pantalla de acceso se encarga */
      })
      .finally(() => setReady(true))
  }, [])

  useEffect(() => {
    if (!ready) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // ⚠️ Cuota agotada. FR-6.6 exige NO confirmar lo que no se puede
      // conservar; se avisa en vez de seguir en silencio.
      setError('No queda espacio en el dispositivo. Sincronice antes de seguir contando.')
    }
  }, [state, ready])

  /**
   * Recupera el catálogo de la ronda abierta al volver a entrar.
   *
   * `catalogo` vive en memoria de React y `activeWarehouseId` en localStorage,
   * así que sobreviven cosas distintas a una recarga: al volver, la ronda sigue
   * abierta y el catálogo está vacío. Y sin catálogo NADA funciona —
   * `resolver()` no encuentra ningún artículo, así que el formulario manual no
   * registra, y `confirmarPorVoz` descarta en silencio lo que el operario
   * acababa de confirmar hablando.
   *
   * Era un fallo invisible: la pantalla se veía normal, los botones respondían,
   * y no pasaba nada. Recargar la página es lo primero que hace cualquiera
   * cuando algo va raro, y hasta ahora era justo lo que lo rompía.
   */
  useEffect(() => {
    if (!ready || catalogo.length > 0) return
    const id = state.activeWarehouseId
    const ronda = id ? state.warehouses[id]?.rondaId : null
    if (!ronda) return

    let vigente = true
    api
      .catalogo(ronda)
      .then((items) => {
        if (vigente) setCatalogo(items)
      })
      .catch(() => {
        if (vigente) setError('No se pudo cargar el catálogo de la bodega. Vuelve a entrar.')
      })
    return () => {
      vigente = false
    }
  }, [ready, catalogo.length, state.activeWarehouseId, state.warehouses])

  // ── La cola ──────────────────────────────────────────────────────────────

  const marcar = useCallback(
    (bodegaId: string, entryId: string, patch: Partial<CountEntry>) => {
      setState((s) => {
        const wh = s.warehouses[bodegaId]
        if (!wh) return s
        return {
          ...s,
          warehouses: {
            ...s.warehouses,
            [bodegaId]: {
              ...wh,
              entries: wh.entries.map((e) => (e.id === entryId ? { ...e, ...patch } : e)),
            },
          },
        }
      })
    },
    [],
  )

  /**
   * Envía lo pendiente. Reintentar es seguro: el servidor deduplica por la
   * clave que este dispositivo generó, así que un envío repetido devuelve
   * exactamente la misma respuesta que el original.
   */
  const drenar = useCallback(async () => {
    if (drenando.current) return
    drenando.current = true

    try {
      for (const [bodegaId, wh] of Object.entries(state.warehouses)) {
        if (!wh.rondaId) continue

        for (const e of wh.entries.filter((x) => x.estadoEnvio === 'pendiente')) {
          try {
            const acuse = await api.registrar(wh.rondaId, {
              articuloId: e.articuloId,
              cantidad: e.quantity,
              unidadId: e.unidadId,
              textoDictado: e.transcript || null,
              confirmaCorreccion: e.isDuplicate,
              // `alertaRespondida` es lo que el operario contestó cuando el
              // servidor marcó discrepancia. Sin esto el registro se reenvía
              // igual y la alerta vuelve a quedar sin responder — que es lo que
              // bloqueaba el cierre.
              confirmaPeseAAlerta: e.isAnomaly || e.alertaRespondida === true,
              claveIdempotencia: e.clave,
            })
            marcar(bodegaId, e.id, {
              estadoEnvio: 'enviado',
              validacion: acuse.validacion.resultado,
              registroId: acuse.registroId,
            })
          } catch (err) {
            // Un fallo de red deja la entrada pendiente: vuelve a intentarse.
            // Un rechazo del servidor sí es definitivo y se marca.
            if (err instanceof api.ErrorApi && err.estado >= 400 && err.estado < 500) {
              marcar(bodegaId, e.id, { estadoEnvio: 'rechazado', error: err.message })
            }
            return
          }
        }
      }
    } finally {
      drenando.current = false
    }
  }, [state.warehouses, marcar])

  useEffect(() => {
    if (!ready) return
    void drenar()
    const t = setInterval(() => void drenar(), 5000)
    const alVolver = () => void drenar()
    window.addEventListener('online', alVolver)
    return () => {
      clearInterval(t)
      window.removeEventListener('online', alVolver)
    }
  }, [ready, drenar])

  // ── Sesión ───────────────────────────────────────────────────────────────

  const login = useCallback(async (username: string, password: string) => {
    setError(null)
    try {
      const s = await api.entrar(username.trim(), password)
      const sesion: Session = {
        username: s.usuarioId,
        role: rolDesdeServidor(s.rol),
        name: s.nombre,
      }
      setState((prev) => ({
        ...prev,
        session: sesion,
        warehouses_disponibles: s.bodegas.map((b) => ({ id: b.id, name: b.nombre })),
      }))
      return sesion
    } catch {
      // Mismo mensaje para "no existe" y "clave mala": distinguirlos permitiría
      // enumerar usuarios probando documentos.
      return null
    }
  }, [])

  const logout = useCallback(async () => {
    await api.salir().catch(() => undefined)
    setState((s) => ({ ...s, session: null, activeWarehouseId: null }))
    setCatalogo([])
  }, [])

  // ── Bodega y catálogo ────────────────────────────────────────────────────

  const selectWarehouse = useCallback(
    async (id: string) => {
      setError(null)
      setState((s) => ({
        ...s,
        activeWarehouseId: id,
        warehouses: s.warehouses[id] ? s.warehouses : { ...s.warehouses, [id]: vacia() },
      }))

      try {
        const ronda = await api.abrirRonda(id)
        const items = await api.catalogo(ronda.rondaId)
        setCatalogo(items)
        setState((s) => ({
          ...s,
          warehouses: {
            ...s.warehouses,
            [id]: { ...(s.warehouses[id] ?? vacia()), rondaId: ronda.rondaId },
          },
        }))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo abrir la ronda.')
      }
    },
    [],
  )

  /**
   * Resuelve el nombre dictado contra el catálogo que está en memoria.
   *
   * **Sin red, a propósito** (F-21b). Si dependiera del servidor, un microcorte
   * impediría contar —no solo enviar, sino contar—. El servidor vuelve a
   * resolver al recibir el registro y es la autoridad; si difiere, marca el
   * registro para el Auditor en vez de corregirlo en silencio (FR-6.9).
   *
   * Cuando el mejor candidato no le saca distancia al segundo, devuelve la
   * lista: el sistema no elige en caso de duda, pregunta.
   */
  const resolver = useCallback(
    (texto: string) => {
      const objetivo = normalizar(texto)
      if (!objetivo) return { articulo: null, candidatos: [] }

      const exacto = catalogo.find((a) => normalizar(a.nombre) === objetivo)
      if (exacto) return { articulo: exacto, candidatos: [] }

      const contiene = catalogo.filter(
        (a) => normalizar(a.nombre).includes(objetivo) || objetivo.includes(normalizar(a.nombre)),
      )
      if (contiene.length === 1) return { articulo: contiene[0]!, candidatos: [] }

      return { articulo: null, candidatos: contiene.slice(0, 5) }
    },
    [catalogo],
  )

  /**
   * El id de una unidad, sacado del catálogo de la bodega.
   *
   * No hay endpoint de unidades y no hace falta: cada artículo declara la suya,
   * así que el catálogo de una bodega contiene los ids de todas las unidades que
   * esa bodega maneja. Si devuelve `null` es porque **ningún** artículo de la
   * bodega usa esa unidad, y entonces el conteo no se puede expresar — se dice,
   * no se sustituye por la unidad esperada.
   */
  const unidades = useMemo(() => {
    const m = new Map<string, string>()
    for (const a of catalogo) m.set(a.unidadEsperada.nombre, a.unidadEsperada.id)
    return m
  }, [catalogo])

  const idDeUnidad = useCallback(
    (u: Unit) => unidades.get(UNIDAD_DEL_SERVIDOR[u]) ?? null,
    [unidades],
  )

  // ── Conteo ───────────────────────────────────────────────────────────────

  const addEntry = useCallback<CountContextValue['addEntry']>((entry) => {
    setState((s) => {
      const id = s.activeWarehouseId
      if (!id) return s
      const wh = s.warehouses[id] ?? vacia()

      const nueva: CountEntry = {
        ...entry,
        id: genId(),
        // La clave se genera AQUÍ y antes de cualquier intento de red.
        clave: api.nuevaClave(),
        order: wh.entries.length,
        capturedAt: new Date().toISOString(),
        estadoEnvio: 'pendiente',
        validacion: null,
      }

      return {
        ...s,
        warehouses: {
          ...s.warehouses,
          [id]: { ...wh, entries: [...wh.entries, nueva], updatedAt: new Date().toISOString() },
        },
      }
    })
  }, [])

  const updateEntry = useCallback<CountContextValue['updateEntry']>((entryId, patch) => {
    setState((s) => {
      const id = s.activeWarehouseId
      if (!id) return s
      const wh = s.warehouses[id]
      if (!wh) return s
      return {
        ...s,
        warehouses: {
          ...s.warehouses,
          [id]: {
            ...wh,
            entries: wh.entries.map((e) =>
              e.id === entryId
                ? {
                    ...e,
                    ...patch,
                    // Corregir vuelve a encolar con clave NUEVA: es otro
                    // registro, no una edición. El servidor conserva los dos.
                    clave: api.nuevaClave(),
                    estadoEnvio: 'pendiente',
                    validacion: null,
                    isDuplicate: true,
                  }
                : e,
            ),
            updatedAt: new Date().toISOString(),
          },
        },
      }
    })
  }, [])

  const removeEntry = useCallback((entryId: string) => {
    setState((s) => {
      const id = s.activeWarehouseId
      if (!id) return s
      const wh = s.warehouses[id]
      if (!wh) return s
      return {
        ...s,
        warehouses: {
          ...s.warehouses,
          [id]: {
            ...wh,
            entries: wh.entries.filter((e) => e.id !== entryId).map((e, i) => ({ ...e, order: i })),
            updatedAt: new Date().toISOString(),
          },
        },
      }
    })
  }, [])

  /**
   * Cierra la ronda.
   *
   * Todo artículo del catálogo que nadie contó exige decidir entre *contado en
   * cero* y *no contado*. Aquí se marcan como `no_contado` —ausencia de
   * afirmación— porque decir "cero" es afirmar que se fue, se miró y no había,
   * y eso solo puede decirlo quien caminó el estante.
   */
  const submitCount = useCallback(async () => {
    const id = state.activeWarehouseId
    const wh = id ? state.warehouses[id] : null
    if (!id || !wh?.rondaId) return

    setError(null)
    await drenar()

    try {
      const cuadre = await api.cuadreDeCierre(wh.rondaId)

      if (cuadre.bloqueos.length > 0) {
        setError(
          `Quedan ${cuadre.bloqueos.length} alertas sin responder: ` +
            cuadre.bloqueos.map((b) => b.nombre).join(', '),
        )
        return
      }

      await api.cerrarRonda(
        wh.rondaId,
        cuadre.pendientes.map((p) => ({ articuloId: p.articuloId, estado: 'no_contado' as const })),
      )

      setState((s) => ({
        ...s,
        warehouses: {
          ...s.warehouses,
          [id]: { ...s.warehouses[id]!, submitted: true, updatedAt: new Date().toISOString() },
        },
      }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cerrar la ronda.')
    }
  }, [state.activeWarehouseId, state.warehouses, drenar])

  const reopenCount = useCallback(() => {
    // Una ronda cerrada es inmutable (FR-1.17): reabrir es abrir OTRA ronda, y
    // el servidor las acumula sin pisar ninguna.
    setState((s) => {
      const id = s.activeWarehouseId
      if (!id || !s.warehouses[id]) return s
      return {
        ...s,
        warehouses: { ...s.warehouses, [id]: { ...s.warehouses[id]!, submitted: false, rondaId: null } },
      }
    })
  }, [])

  /** El reconteo del Auditor. Exige causa del catálogo controlado (R4). */
  const reviewItem = useCallback(
    async (warehouseId: string, entryId: string, review: Review) => {
      setState((s) => {
        const wh = s.warehouses[warehouseId]
        if (!wh) return s
        return {
          ...s,
          warehouses: {
            ...s.warehouses,
            [warehouseId]: { ...wh, reviews: { ...wh.reviews, [entryId]: review } },
          },
        }
      })

      const entrada = state.warehouses[warehouseId]?.entries.find((e) => e.id === entryId)
      if (!entrada || review.status !== 'corregido' || !review.codigoRazonId) return

      // El reconteo puede corregir la unidad además de la cantidad; si el
      // Auditor no la tocó, la del conteo original es la buena.
      const unidadId =
        review.auditorUnit === entrada.unit ? entrada.unidadId : idDeUnidad(review.auditorUnit)
      if (!unidadId) {
        setError('Esa unidad no existe en el catálogo de la bodega.')
        return
      }

      try {
        await api.recontar(warehouseId, entrada.articuloId, {
          cantidad: review.auditorQuantity,
          unidadId,
          codigoRazonId: review.codigoRazonId,
        })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo registrar el reconteo.')
      }
    },
    [state.warehouses, idDeUnidad],
  )

  /**
   * Un hallazgo: algo que está en el estante y no en el catálogo.
   *
   * No se encola como los conteos porque no lo es — no tiene `articuloId` y no
   * puede compararse con ningún saldo. Va directo, y si la red falla se avisa:
   * inventarle una cola aparte por un caso que ocurre unas pocas veces por
   * ronda sería complejidad que nadie va a mantener.
   */
  const reportarHallazgo = useCallback<CountContextValue['reportarHallazgo']>(
    async (h) => {
      const id = state.activeWarehouseId
      const wh = id ? state.warehouses[id] : null
      if (!wh?.rondaId) return
      try {
        await api.reportarFantasma(wh.rondaId, {
          descripcion: h.nombre,
          unidadObservada: h.unidad ?? 'Unidad',
          cantidad: h.cantidad,
          confirmaNoEsDelCatalogo: true,
        })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo anotar el hallazgo.')
      }
    },
    [state.activeWarehouseId, state.warehouses],
  )

  const alertasSinResponder = useMemo(() => {
    const id = state.activeWarehouseId
    const wh = id ? state.warehouses[id] : null
    return (wh?.entries ?? []).filter(
      (e) =>
        e.estadoEnvio === 'enviado' &&
        e.validacion?.startsWith('alerta') === true &&
        e.alertaRespondida !== true,
    )
  }, [state.activeWarehouseId, state.warehouses])

  const sostenerConteo = useCallback(
    (entryId: string) => {
      const id = state.activeWarehouseId
      if (!id) return
      // Reenvía con clave NUEVA y `confirmaPeseAAlerta`: es otra afirmación del
      // operario, no una edición de la anterior. Las dos quedan en la traza.
      marcar(id, entryId, {
        alertaRespondida: true,
        clave: api.nuevaClave(),
        estadoEnvio: 'pendiente',
        validacion: null,
      })
    },
    [state.activeWarehouseId, marcar],
  )

  const clearWarehouse = useCallback((id: string) => {
    setState((s) => {
      const next = { ...s.warehouses }
      delete next[id]
      return { ...s, warehouses: next }
    })
  }, [])

  const getWarehouse = useCallback(
    (id: string | null | undefined) => state.warehouses_disponibles.find((w) => w.id === id) ?? null,
    [state.warehouses_disponibles],
  )

  const active = state.activeWarehouseId
    ? (state.warehouses[state.activeWarehouseId] ?? null)
    : null

  const pendientes = useMemo(
    () =>
      Object.values(state.warehouses).reduce(
        (n, wh) => n + wh.entries.filter((e) => e.estadoEnvio === 'pendiente').length,
        0,
      ),
    [state.warehouses],
  )

  const value = useMemo<CountContextValue>(
    () => ({
      ...state,
      active,
      catalogo,
      pendientes,
      error,
      ready,
      getWarehouse,
      login,
      logout,
      selectWarehouse,
      resolver,
      idDeUnidad,
      reportarHallazgo,
      alertasSinResponder,
      sostenerConteo,
      addEntry,
      updateEntry,
      removeEntry,
      submitCount,
      reopenCount,
      reviewItem,
      clearWarehouse,
    }),
    [
      state, active, catalogo, pendientes, error, ready, getWarehouse, login, logout,
      selectWarehouse, resolver, idDeUnidad, reportarHallazgo, alertasSinResponder, sostenerConteo, addEntry, updateEntry, removeEntry, submitCount,
      reopenCount, reviewItem, clearWarehouse,
    ],
  )

  return <CountContext.Provider value={value}>{children}</CountContext.Provider>
}

export function useCountStore() {
  const ctx = useContext(CountContext)
  if (!ctx) throw new Error('useCountStore debe usarse dentro de CountProvider')
  return ctx
}

/** Para pintar lo que el servidor devuelve con los nombres de la interfaz. */
export { unidadDesdeServidor }
