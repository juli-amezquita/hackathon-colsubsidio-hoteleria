import type {
  ArticuloDeTrabajo,
  ResolucionArticulo,
  ResultadoValidacion,
  Rol,
  Ronda,
} from '@cci/contracts'

/**
 * El cliente de la API. El ÚNICO sitio del frontend que sabe de red.
 *
 * Mismo origen que la API, y eso no es una comodidad: la cookie de sesión es
 * `SameSite=Strict`, así que un frontend servido desde otro dominio no la
 * enviaría y todo respondería 401. Por eso no hay `API_URL` configurable —
 * apuntar a otro origen no funcionaría, y una opción que no funciona es peor
 * que no tenerla.
 */

export interface Sesion {
  usuarioId: string
  nombre: string
  rol: Rol
  bodegas: { id: string; nombre: string }[]
}

export class ErrorApi extends Error {
  constructor(
    readonly codigo: string,
    mensaje: string,
    readonly estado: number,
    readonly detalles?: unknown,
  ) {
    super(mensaje)
  }
}

async function pedir<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  const tieneCuerpo = opciones.body !== undefined

  const r = await fetch(ruta, {
    ...opciones,
    // La sesión viaja en cookie `HttpOnly`: no se puede leer por JavaScript, y
    // sin esto el navegador no la manda.
    credentials: 'include',
    headers: {
      ...(tieneCuerpo ? { 'content-type': 'application/json' } : {}),
      ...opciones.headers,
    },
  })

  if (r.status === 204) return undefined as T

  const cuerpo: unknown = await r.json().catch(() => null)

  if (!r.ok) {
    const e = (cuerpo ?? {}) as { codigo?: string; mensaje?: string; detalles?: unknown }
    throw new ErrorApi(
      e.codigo ?? 'ERROR_DESCONOCIDO',
      e.mensaje ?? `La petición falló (HTTP ${r.status}).`,
      r.status,
      e.detalles,
    )
  }

  return cuerpo as T
}

/** Cada envío lleva su clave, generada AQUÍ y antes de intentar la red (FR-6.2). */
export const nuevaClave = (): string =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`

// ── Sesión ─────────────────────────────────────────────────────────────────

export const entrar = (usuario: string, password: string) =>
  pedir<Sesion>('/sesion', { method: 'POST', body: JSON.stringify({ usuario, password }) })

export const sesionActual = () => pedir<Sesion>('/sesion')

export const salir = () => pedir<void>('/sesion/cierre', { method: 'POST' })

// ── Ronda ──────────────────────────────────────────────────────────────────

/**
 * Abre una ronda propia sobre la bodega.
 *
 * `epochCliente` sirve para medir el desfase del reloj del dispositivo (D-16):
 * no corrige nada, hace que un aparato desajustado quede visible en la traza.
 */
export const abrirRonda = (bodegaId: string) =>
  pedir<Ronda>('/rondas', {
    method: 'POST',
    body: JSON.stringify({ bodegaId, epochCliente: Date.now() }),
  })

/** El catálogo de la bodega. Se cachea en el dispositivo. **Sin saldos.** */
export const catalogo = (rondaId: string) =>
  pedir<{ items: ArticuloDeTrabajo[] }>(`/rondas/${rondaId}/catalogo`).then((r) => r.items)

/** Resuelve el nombre dictado. Cuando duda devuelve candidatos, no elige. */
export const resolverNombre = (rondaId: string, textoDictado: string) =>
  pedir<ResolucionArticulo>(`/rondas/${rondaId}/resolucion-articulo`, {
    method: 'POST',
    body: JSON.stringify({ textoDictado }),
  })

export interface RegistroEnviado {
  articuloId: string
  cantidad: number
  unidadId: string
  textoDictado?: string | null
  /** El operario ya contó este artículo y confirma que reemplaza el valor. */
  confirmaCorreccion?: boolean
  /** El operario sostiene su conteo pese a la alerta (FR-2.4). */
  confirmaPeseAAlerta?: boolean
  claveIdempotencia: string
}

export interface Acuse {
  registroId: string
  secuencia: number
  recibidoEn: string
  validacion: ResultadoValidacion
}

export const registrar = (rondaId: string, r: RegistroEnviado) =>
  pedir<Acuse>(`/rondas/${rondaId}/registros`, {
    method: 'POST',
    body: JSON.stringify({
      articuloId: r.articuloId,
      cantidad: r.cantidad,
      unidadId: r.unidadId,
      estado: 'contado',
      modoCaptura: r.textoDictado ? 'voz' : 'texto',
      origenParse: r.textoDictado ? 'gramatica' : 'manual',
      origenNombre: r.textoDictado ? 'similitud' : null,
      textoDictado: r.textoDictado ?? null,
      capturadoEn: new Date().toISOString(),
      claveIdempotencia: r.claveIdempotencia,
      confirmaCorreccion: r.confirmaCorreccion ?? false,
      confirmaPeseAAlerta: r.confirmaPeseAAlerta ?? false,
    }),
  })

export interface EstadoRonda {
  rondaId: string
  bodegaId: string
  contados: number
  total: number
  /** Los últimos 3–5 con éxito: el historial y el punto por donde retomar. */
  ultimos: {
    articuloId: string
    nombre: string
    cantidad: string | null
    estado: string
    validacion: string | null
    recibidoEn: string
  }[]
  /** Alertas que llegaron DIFERIDAS, mientras el operario ya iba en otro lado. */
  pendientesDeResolver: {
    registroId: string
    articuloId: string
    nombre: string
    motivo: string
  }[]
}

export const estadoRonda = (rondaId: string) => pedir<EstadoRonda>(`/rondas/${rondaId}/estado`)

export interface Cuadre {
  pendientes: { articuloId: string; nombre: string; codigo: string | null }[]
  bloqueos: { articuloId: string; nombre: string; registroId: string; motivo: string }[]
}

export const cuadreDeCierre = (rondaId: string) =>
  pedir<Cuadre>(`/rondas/${rondaId}/cuadre-cierre`)

/**
 * Cierra la ronda. Cada artículo no contado exige decidir entre *contado en
 * cero* y *no contado* — y son distintos para siempre (FR-1.16).
 */
export const cerrarRonda = (
  rondaId: string,
  decisiones: { articuloId: string; estado: 'contado_en_cero' | 'no_contado' }[],
) =>
  pedir<{ rondaId: string; cerrada: boolean; articulosResueltos: number }>(
    `/rondas/${rondaId}/cierre`,
    {
      method: 'POST',
      body: JSON.stringify({
        decisiones: decisiones.map((d) => ({ ...d, claveIdempotencia: nuevaClave() })),
      }),
    },
  )

/** Hallazgo físico sin correspondencia en el catálogo (FR-5.x). */
export const reportarFantasma = (
  rondaId: string,
  f: {
    descripcion: string
    unidadObservada: string
    cantidad: number
    confirmaNoEsDelCatalogo?: boolean
  },
) =>
  pedir<{ fantasmaId: string; recibidoEn: string; candidatosDescartados: number }>(
    `/rondas/${rondaId}/fantasmas`,
    {
      method: 'POST',
      body: JSON.stringify({
        ...f,
        modoCaptura: 'voz',
        capturadoEn: new Date().toISOString(),
        claveIdempotencia: nuevaClave(),
        confirmaNoEsDelCatalogo: f.confirmaNoEsDelCatalogo ?? false,
      }),
    },
  )

// ── Auditor ────────────────────────────────────────────────────────────────

export const codigosDeRazon = () =>
  pedir<{ items: { id: string; descripcion: string }[] }>('/auditoria/codigos-razon').then(
    (r) => r.items,
  )

export const pendientesDeAuditoria = (bodegaId: string) =>
  pedir<{
    items: {
      articuloId: string | null
      fantasmaId: string | null
      nombre: string
      motivo: string
    }[]
  }>(`/auditoria/bodegas/${bodegaId}/pendientes`).then((r) => r.items)

export interface RondaDelCaso {
  rondaId: string
  operador: string
  cerradaEn: string | null
  estado: string
  cantidad: string | null
  resultadoValidacion: string | null
  /** Contra el saldo esperado. Solo el Auditor puede verla. */
  diferencia: string | null
  /** Si esta ronda la contó el propio Auditor: rompería su independencia. */
  contadaPorEsteAuditor: boolean
}

export interface CasoAuditoria {
  articulo: { articuloId: string; nombre: string; codigo: string | null; unidad: string; unidadId: string }
  clasificacion: string
  motivo: string | null
  /** ⚠️ Solo el Auditor lo ve. Un Operador recibe 403 en esta ruta. */
  saldoEsperado: string | null
  rondas: RondaDelCaso[]
  reconteos: { auditor: string; cantidad: string; codigoRazon: string; registradoEn: string }[]
  valorFinal: string | null
  origenValor: string | null
  /** El árbitro ORDENA la evidencia. No dice quién tiene razón. */
  sintesis: {
    relato: string
    observaciones: string[]
    preguntas: string[]
    razonesPlausibles: string[]
  } | null
  arbitro: string | null
}

export const casoDeAuditoria = (bodegaId: string, articuloId: string) =>
  pedir<CasoAuditoria>(`/auditoria/bodegas/${bodegaId}/articulos/${articuloId}`)

export interface CasoFantasma {
  fantasma: {
    fantasmaId: string
    descripcion: string
    unidadObservada: string
    cantidad: string
    operador: string
    recibidoEn: string
    modoCaptura: string
  }
  candidatosCatalogo: unknown
  otrosHallazgos: { fantasmaId: string; descripcion: string; cantidad: string; operador: string }[]
}

export const casoDeFantasma = (bodegaId: string, fantasmaId: string) =>
  pedir<CasoFantasma>(`/auditoria/bodegas/${bodegaId}/fantasmas/${fantasmaId}`)

/**
 * Resuelve un hallazgo. Con causa, igual que un artículo del catálogo.
 *
 * Sin causa no se cierra nada (R4, FR-4.4): una discrepancia sin explicación es
 * un número que nadie puede defender ante el sistema central.
 */
export const resolverFantasma = (
  bodegaId: string,
  fantasmaId: string,
  r: { cantidad: number; unidadId: string; codigoRazonId: string },
) =>
  pedir<{ reconteoId: string; secuencia: number }>(
    `/auditoria/bodegas/${bodegaId}/fantasmas/${fantasmaId}/resolucion`,
    {
      method: 'POST',
      body: JSON.stringify({
        ...r,
        modoCaptura: 'texto',
        capturadoEn: new Date().toISOString(),
        claveIdempotencia: nuevaClave(),
      }),
    },
  )

export const recontar = (
  bodegaId: string,
  articuloId: string,
  r: { cantidad: number; unidadId: string; codigoRazonId: string },
) =>
  pedir<{ reconteoId: string; secuencia: number; conflictoIndependencia: boolean }>(
    `/auditoria/bodegas/${bodegaId}/articulos/${articuloId}/reconteo`,
    {
      method: 'POST',
      body: JSON.stringify({
        ...r,
        modoCaptura: 'texto',
        capturadoEn: new Date().toISOString(),
        claveIdempotencia: nuevaClave(),
      }),
    },
  )

// ── Voz ────────────────────────────────────────────────────────────────────

/**
 * Credencial efímera para hablar con el transcriptor.
 *
 * El navegador conecta DIRECTO con el proveedor; nuestra clave de cuenta jamás
 * sale del servidor (D-07-A). Viene con el vocabulario de la bodega dentro
 * (F-36): el transcriptor decide entre "acelga" y "aceite" con un modelo
 * general del español, y con el catálogo delante decide entre lo que puede
 * aparecer en ESA bodega.
 */
export const credencialDeVoz = (rondaId: string) =>
  pedir<{
    token: string
    expiraEn: string
    proveedor: string
    endpoint: string
    opciones: Record<string, string | number | boolean>
  }>(`/voz/token/${rondaId}`, { method: 'POST' })

// ── Cierre del inventario ──────────────────────────────────────────────────

export interface ItemConsolidado {
  codigo: string | null
  nombre: string
  unidad: string
  clasificacion: string
  motivo: string | null
  /** ⚠️ Solo Auditor y Administrador. Es el saldo de la tabla madre. */
  saldoSistema: string | null
  valorFinal: string | null
  origenValor: string | null
  codigoRazon: string | null
  rondasAfirmando: number
}

export const consolidado = (bodegaId: string) =>
  pedir<{ items: ItemConsolidado[] }>(`/integracion/bodegas/${bodegaId}/consolidado`).then(
    (r) => r.items,
  )

/**
 * Cierra el inventario de la bodega. **Es lo único que mueve la tabla madre.**
 *
 * Hasta aquí, ningún conteo de ningún operario ha tocado `saldo_esperado`: el
 * libro solo acumula afirmaciones (D8). El saldo se mueve con el aval del
 * Auditor, en este momento y no antes (FR-7.9).
 */
export const cerrarInventario = (bodegaId: string) =>
  // Los nombres son los que devuelve el servidor, comprobados uno a uno.
  //
  // Aquí decía `articulosActualizados`, campo que la respuesta NUNCA ha
  // tenido: el panel de éxito del cierre —el clímax de todo el producto—
  // pintaba «undefined artículos actualizados». TypeScript no lo detecta
  // porque el tipo se declara a mano en el cliente y nada lo confronta con la
  // respuesta real.
  pedir<{
    bodegaId: string
    periodo: string
    cerradoEn: string
    hashConsolidado: string
    articulos: number
    saldosActualizados: number
    congeladosEnHistorico: number
  }>(
    `/integracion/bodegas/${bodegaId}/cierre`,
    // Sin cuerpo: el endpoint no lo recibe. La idempotencia la da el propio
    // cierre — una bodega ya cerrada no se vuelve a cerrar.
    { method: 'POST' },
  )

/** La URL de descarga. No pasa por `fetch`: la abre el navegador. */
export const urlExportacion = (bodegaId: string, formato: 'csv' | 'json') =>
  `/integracion/bodegas/${bodegaId}/exportacion.${formato}`
