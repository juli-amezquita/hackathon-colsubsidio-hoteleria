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
 * `login`, `selectWarehouse`, `addEntry`, `submitCount`— para
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
  /**
   * De quién es la cola. Pertenece a quien contó, no al aparato.
   *
   * En una bodega el teléfono se comparte: el operario A termina su turno sin
   * cobertura y entra B en el mismo navegador. Sin esta marca, lo que quedó
   * pendiente de A se enviaría con la cookie de B —rechazado y perdido— y a B
   * la pantalla le diría que hay conteos suyos esperando red.
   */
  owner: string | null
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
  /** `false` si la ronda no abrió. El motivo queda en `error`. */
  selectWarehouse: (id: string) => Promise<boolean>
  /** Resuelve un nombre dictado contra el catálogo cacheado. Sin red. */
  resolver: (texto: string) => { articulo: ArticuloDeTrabajo | null; candidatos: ArticuloDeTrabajo[] }
  addEntry: (entry: Omit<CountEntry, 'id' | 'clave' | 'order' | 'capturedAt' | 'estadoEnvio' | 'validacion'>) => void
  /** El id de una unidad en el catálogo de la bodega abierta. `null` si esa bodega no la maneja. */
  idDeUnidad: (u: Unit) => string | null
  updateEntry: (id: string, patch: Partial<Omit<CountEntry, 'id' | 'order'>>) => void
  removeEntry: (id: string) => void
  /**
   * Hallazgo físico sin correspondencia en el catálogo (Historia 5, FR-5.x).
   *
   * Devuelve si el servidor lo aceptó: quien lo reporta necesita saberlo para
   * no decirle "anotado" al operario sobre algo que no se anotó.
   */
  reportarHallazgo: (h: {
    nombre: string
    cantidad: number
    unidad: string | null
  }) => Promise<boolean>
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
  clearWarehouse: (id: string) => void
}

const STORAGE_KEY = 'cci-conteo-v3'

const CountContext = createContext<CountContextValue | null>(null)

const initialState: CountState = {
  session: null,
  owner: null,
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
  /** El drenado en curso (o el último encolado). Se puede esperar. */
  const cola = useRef<Promise<void> | null>(null)
  /** Ya hay una pasada haciendo fila detrás de la que corre. */
  const esperando = useRef(false)
  /**
   * El estado más reciente para lo que no se re-renderiza.
   *
   * El drenado corre en un intervalo y desde `submitCount`; si trabajara sobre
   * la foto que tenía al montarse, reenviaría lo que la pasada anterior ya
   * confirmó y no vería lo que se acaba de capturar.
   */
  const estadoRef = useRef(state)
  estadoRef.current = state

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
        setState((prev) => {
          const sesion: Session = {
            username: s.usuarioId,
            role: rolDesdeServidor(s.rol),
            name: s.nombre,
          }
          const ajena = prev.owner !== null && prev.owner !== sesion.username
          return {
            ...prev,
            session: sesion,
            owner: sesion.username,
            // La cola del disco es de otro operario: no se hereda.
            warehouses: ajena ? {} : prev.warehouses,
            activeWarehouseId: ajena ? null : prev.activeWarehouseId,
            warehouses_disponibles: s.bodegas.map((b) => ({ id: b.id, name: b.nombre })),
          }
        }),
      )
      .catch((e: unknown) => {
        // Solo el SERVIDOR invalida una sesión. Si esto falló por red —lo
        // normal al reabrir la app en una bodega sin señal— la sesión del
        // disco se conserva y el operario sigue contando.
        //
        // Pero si el servidor dijo 401/403, la sesión no puede quedarse
        // pintada como válida: el operario seguía viendo su nombre, contaba
        // treinta artículos y cada envío volvía 401. La cola SÍ se conserva:
        // esos conteos son suyos y se envían cuando vuelva a entrar.
        if (e instanceof api.ErrorApi && (e.estado === 401 || e.estado === 403)) {
          setState((prev) => ({ ...prev, session: null, warehouses_disponibles: [] }))
        }
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
        const siguiente = {
          ...s,
          warehouses: {
            ...s.warehouses,
            [bodegaId]: {
              ...wh,
              entries: wh.entries.map((e) => (e.id === entryId ? { ...e, ...patch } : e)),
            },
          },
        }
        // El ref se adelanta al render. `submitCount` consulta la cola en el
        // microtask siguiente al drenado y React todavía no ha re-renderizado:
        // sin esto vería como pendiente lo que el servidor acaba de acusar y
        // se negaría a cerrar una ronda que sí está completa.
        estadoRef.current = siguiente
        return siguiente
      })
    },
    [],
  )

  /**
   * El servidor no reconoce la sesión.
   *
   * Se cae la sesión, **no la cola**: lo contado es del operario y sigue
   * valiendo. Al volver a entrar con el mismo documento se envía solo.
   */
  const sesionCaducada = useCallback(() => {
    // No hay sesión que caducar —por ejemplo, el último envío que hace `logout`
    // con la cookie ya invalidada—: no se avisa de algo que no le pasó a nadie.
    const actual = estadoRef.current
    if (!actual.session) return
    estadoRef.current = { ...actual, session: null }
    setState((s) => ({ ...s, session: null }))
    setError('Tu sesión venció. Vuelve a entrar: lo que contaste sigue guardado en el teléfono.')
  }, [])

  /**
   * Una pasada por la cola de un estado concreto.
   *
   * Recibe el estado en vez de leerlo porque `logout` necesita vaciar la cola
   * del operario que se va con la cookie que todavía es suya, y para entonces
   * ese estado ya no está montado.
   *
   * No lanza nunca: si algo revienta, lo pendiente sigue pendiente.
   */
  const enviarCola = useCallback(
    async (estado: CountState) => {
      // Sin sesión no se envía nada. Cada `registrar` volvería 401 —y peor, con
      // la cookie de quien esté usando el aparato ahora, que puede no ser quien
      // contó.
      if (!estado.session) return

      try {
        for (const [bodegaId, wh] of Object.entries(estado.warehouses)) {
          if (!wh.rondaId) continue

          for (const e of wh.entries.filter((x) => x.estadoEnvio === 'pendiente')) {
            try {
              const acuse = await api.registrar(wh.rondaId, {
                articuloId: e.articuloId,
                cantidad: e.quantity,
                unidadId: e.unidadId,
                // Un conteo SOSTENIDO viaja como texto aunque se hubiera dictado.
                //
                // No es un detalle de formato: `pendiente_de_resolver` exige
                // evidencia de audio para todo lo sostenido en modo voz, y este
                // producto no graba audio en ningún punto (`pendingAudioRef` solo
                // se pone a `null`, no existe un `MediaRecorder`). El resultado
                // era una ronda que NO SE PODÍA CERRAR JAMÁS: el operario
                // sostenía su conteo, el servidor pedía un audio que nadie podía
                // subir, y el cierre quedaba bloqueado para siempre.
                //
                // Sostener es pulsar un botón en la pantalla, no dictar. Que
                // viaje como texto describe lo que de verdad ocurrió y conserva
                // la respuesta a la alerta, que es lo que FR-2.4 exige. El
                // dictado original ya está en el libro, inmutable, en el registro
                // anterior.
                textoDictado: e.alertaRespondida === true ? null : e.transcript || null,
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
              // 401/403 NO es un rechazo del conteo: es "vuelve a entrar".
              // Marcarlo `rechazado` —que es definitivo— borraba la ronda
              // entera de un operario cuya sesión había caducado, sin un
              // mensaje. Queda pendiente y lo que se cae es la sesión.
              if (err instanceof api.ErrorApi && (err.estado === 401 || err.estado === 403)) {
                sesionCaducada()
                return
              }
              // 400/409/422 sí son definitivos: el servidor no va a aceptar
              // este registro por mucho que se reintente. Se marca y se sigue
              // con el resto —parar aquí atascaba la cola detrás de un solo
              // registro malo, y con la cola sin vaciar no se puede cerrar.
              if (err instanceof api.ErrorApi && err.estado >= 400 && err.estado < 500) {
                marcar(bodegaId, e.id, { estadoEnvio: 'rechazado', error: err.message })
                continue
              }
              // Fallo de red: la entrada queda pendiente y vuelve a intentarse.
              return
            }
          }
        }
      } catch {
        // Nada puede romper la cadena de drenados: el siguiente intento recoge
        // lo que quedó.
      }
    },
    [marcar, sesionCaducada],
  )

  /**
   * Envía lo pendiente. Reintentar es seguro: el servidor deduplica por la
   * clave que este dispositivo generó, así que un envío repetido devuelve
   * exactamente la misma respuesta que el original.
   *
   * **Se puede esperar de verdad.** Antes, con un drenado ya en curso, esto
   * devolvía una promesa ya resuelta: `submitCount` hacía `await drenar()`
   * creyendo que había vaciado la cola, el cuadre del servidor no veía los
   * registros que seguían en vuelo, y el cierre los grababa `no_contado`.
   * Veinte conteos reales convertidos en "nadie lo contó", en silencio.
   */
  const drenar = useCallback((): Promise<void> => {
    const enCurso = cola.current
    if (!enCurso) {
      const p: Promise<void> = enviarCola(estadoRef.current).finally(() => {
        if (cola.current === p) cola.current = null
      })
      cola.current = p
      return p
    }
    // Ya hay uno corriendo, y pudo empezar antes de lo que se acaba de
    // encolar: se garantiza una pasada más detrás. Solo una — apilar una por
    // cada tick de 5 s haría crecer la cadena sin fin con la red lenta.
    if (esperando.current) return enCurso
    esperando.current = true
    const reanudar = () => {
      esperando.current = false
    }
    const p: Promise<void> = enCurso
      .then(reanudar, reanudar)
      .then(() => enviarCola(estadoRef.current))
      .finally(() => {
        if (cola.current === p) cola.current = null
      })
    cola.current = p
    return p
  }, [enviarCola])

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
      setState((prev) => {
        // La cola es de quien contó. Si el aparato traía pendientes de OTRO
        // operario, se descartan aquí: enviarlos con esta cookie sería
        // atribuirle a este usuario conteos que no hizo.
        const ajena = prev.owner !== null && prev.owner !== sesion.username
        return {
          ...prev,
          session: sesion,
          owner: sesion.username,
          warehouses: ajena ? {} : prev.warehouses,
          activeWarehouseId: ajena ? null : prev.activeWarehouseId,
          warehouses_disponibles: s.bodegas.map((b) => ({ id: b.id, name: b.nombre })),
        }
      })
      return sesion
    } catch {
      // Mismo mensaje para "no existe" y "clave mala": distinguirlos permitiría
      // enumerar usuarios probando documentos.
      return null
    }
  }, [])

  /**
   * Cierra la sesión y **se lleva la cola**.
   *
   * En un teléfono de bodega el turno siguiente entra en el mismo navegador:
   * dejar los pendientes ahí hacía que el intervalo de 5 s los enviara con la
   * cookie del nuevo operario —403, perdidos— mientras a él la pantalla le
   * decía que hay conteos suyos esperando red.
   *
   * Antes de soltarlos se hace un último intento con la cookie de quien se va,
   * que sigue viva un instante más. La sesión se limpia primero para que la
   * pantalla responda al toque y no rebote contra el acceso.
   */
  const logout = useCallback(async () => {
    const antes = estadoRef.current
    const limpio: CountState = {
      ...antes,
      session: null,
      owner: null,
      activeWarehouseId: null,
      warehouses: {},
    }
    // El ref también, y no solo el estado: si no, el drenado del intervalo
    // seguiría viendo la cola del operario que se acaba de ir.
    estadoRef.current = limpio
    setState(limpio)
    setCatalogo([])
    setError(null)
    // `antes` a propósito: es la cola de quien se va, con su cookie, que
    // todavía vale hasta la línea siguiente.
    await enviarCola(antes)
    await api.salir().catch(() => undefined)
  }, [enviarCola])

  // ── Bodega y catálogo ────────────────────────────────────────────────────

  /**
   * Abre la ronda de una bodega. Devuelve si lo consiguió.
   *
   * Lo devuelve porque quien navega necesita saberlo: la pantalla de bodegas
   * empujaba al conteo sin esperar y, si la ronda no abría, quedaba en
   * "Abriendo la ronda…" para siempre, sin error y sin salida.
   */
  const selectWarehouse = useCallback(
    async (id: string): Promise<boolean> => {
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
        return true
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo abrir la ronda.')
        return false
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

    // Lo que no ha llegado al servidor no existe para el cuadre: vuelve como
    // pendiente y el cierre lo graba `no_contado`. Cerrar con la cola a medio
    // vaciar convierte conteos reales en "nadie lo contó", así que no se
    // cierra hasta que no quede nada por enviar.
    const alCerrar = estadoRef.current.warehouses[id]?.entries ?? []
    const enCola = alCerrar.filter((e) => e.estadoEnvio === 'pendiente').length
    if (enCola > 0) {
      setError(
        `Faltan ${enCola} ${enCola === 1 ? 'conteo' : 'conteos'} por enviar. ` +
          'Busca señal y espera a que la cola quede en cero: cerrar ahora los daría por no contados.',
      )
      return
    }

    const rechazados = alCerrar.filter((e) => e.estadoEnvio === 'rechazado').length
    if (rechazados > 0) {
      setError(
        `El sistema no aceptó ${rechazados} ${rechazados === 1 ? 'conteo' : 'conteos'}. ` +
          'Corrígelos o quítalos de la lista antes de cerrar: si no, quedarían como no contados.',
      )
      return
    }

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
      if (!wh?.rondaId) {
        setError('La ronda no está abierta: el hallazgo no se pudo anotar.')
        return false
      }
      try {
        await api.reportarFantasma(wh.rondaId, {
          descripcion: h.nombre,
          unidadObservada: h.unidad ?? 'Unidad',
          cantidad: h.cantidad,
          confirmaNoEsDelCatalogo: true,
        })
        return true
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo anotar el hallazgo.')
        return false
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

  // Un conteo recién capturado se intenta enviar en el acto, sin esperar al
  // tick. Antes esto salía gratis porque `drenar` cambiaba con cada cambio de
  // estado y el efecto del intervalo se rehacía — lo que además reiniciaba el
  // temporizador en cada pulsación. Ahora el intervalo es fijo y el empujón es
  // explícito.
  useEffect(() => {
    if (ready && pendientes > 0) void drenar()
  }, [ready, pendientes, drenar])

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
      clearWarehouse,
    }),
    [
      state, active, catalogo, pendientes, error, ready, getWarehouse, login, logout,
      selectWarehouse, resolver, idDeUnidad, reportarHallazgo, alertasSinResponder, sostenerConteo, addEntry, updateEntry, removeEntry, submitCount,
      reopenCount, clearWarehouse,
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
