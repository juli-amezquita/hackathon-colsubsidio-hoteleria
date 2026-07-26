import { normalizar } from '@cci/gramatica';

/**
 * H9-01 · El catálogo CERRADO de lo que se puede preguntar.
 *
 * Es la pieza que hace seguro el modo consulta, y conviene ver por qué.
 *
 * La forma obvia de construir "pregúntale al inventario en voz natural" es dar
 * al modelo acceso a la base o montar un RAG sobre todo. Las dos comparten un
 * problema: a la pregunta "¿qué puede llegar a decir?" la única respuesta
 * honesta es "hay que probarlo". Y este sistema tiene datos que un rol no puede
 * ver —el saldo esperado— cuya protección no puede depender de que un prompt
 * aguante.
 *
 * Aquí la superficie es **enumerable**: estas cuatro intenciones, cada una con
 * su consulta determinista. Se puede leer la lista y saber exactamente qué
 * puede salir. Ampliarla es añadir una entrada, y añadirla se ve en el
 * repositorio.
 *
 * El modelo elige entre estas opciones; no compone la respuesta con acceso
 * libre. Es el mismo patrón del árbitro: ordena y presenta, no decide ni
 * fabrica.
 */

export type Intencion = 'estado' | 'pendientes' | 'salidas' | 'ayuda';

export interface PreguntaResuelta {
  readonly intencion: Intencion;
  /** Qué se entendió, para que el supervisor lo verifique de un vistazo. */
  readonly entendido: string;
}

interface Patron {
  readonly intencion: Intencion;
  readonly entendido: string;
  /** Basta con que aparezca UNA. Se comparan sobre el texto normalizado. */
  readonly claves: readonly string[];
}

/**
 * Los patrones, en orden de especificidad.
 *
 * Deliberadamente en español coloquial de bodega y no en jerga del sistema: un
 * supervisor pregunta "¿qué falta?", no "¿cuáles son los ítems auditables sin
 * resolver?". Que la primera funcione es la diferencia entre que use el modo o
 * lo abandone.
 */
const PATRONES: readonly Patron[] = [
  {
    intencion: 'pendientes',
    entendido: 'Qué queda por resolver',
    claves: [
      'que falta', 'falta por', 'pendiente', 'pendientes', 'por resolver',
      'sin resolver', 'auditable', 'auditables', 'revisar', 'diferencia',
      'diferencias', 'problema', 'problemas',
    ],
  },
  {
    intencion: 'salidas',
    entendido: 'Qué se envió y qué se descargó',
    claves: ['envio', 'envios', 'enviado', 'erp', 'sistema central', 'descarga', 'descargas', 'exporto', 'exportado', 'salida', 'salidas'],
  },
  {
    intencion: 'estado',
    entendido: 'Cómo va el inventario',
    claves: ['como va', 'estado', 'avance', 'resumen', 'cuanto llevamos', 'como esta', 'conciliado', 'conciliados', 'inventario'],
  },
  {
    intencion: 'ayuda',
    entendido: 'Qué se puede preguntar',
    claves: ['ayuda', 'que puedo preguntar', 'que sabes', 'opciones', 'que puedes'],
  },
];

/**
 * Verbos de acción.
 *
 * Si aparecen, la respuesta es "no puedo modificar nada" ANTES de mirar las
 * intenciones de lectura. Sin esto, "cierra el inventario" cae en `estado` —
 * porque contiene "inventario"— y el supervisor recibe un resumen justo después
 * de pedir que se cierre algo. No escribiría nada, pero leer un resumen como
 * respuesta a una orden se parece demasiado a un acuse.
 */
const VERBOS_DE_ACCION = [
  'borra', 'borre', 'elimina', 'elimine', 'cambia', 'cambie', 'modifica',
  'modifique', 'actualiza', 'actualice', 'cierra', 'cierre', 'aprueba',
  'apruebe', 'ajusta', 'ajuste', 'corrige', 'corrija', 'envia', 'envía',
  'registra', 'registre', 'ignora', 'ignore', 'olvida', 'olvide',
];

/**
 * Resuelve la pregunta contra el catálogo.
 *
 * Determinista y sin red: la misma pregunta da la misma intención hoy y dentro
 * de un año. Cuando ninguna coincide devuelve `ayuda` en vez de adivinar —
 * responder algo plausible a una pregunta que no se entendió es peor que
 * decir que no se entendió.
 */
export function resolver(pregunta: string): PreguntaResuelta {
  const texto = normalizar(pregunta);

  if (VERBOS_DE_ACCION.some((v) => new RegExp(`\\b${v}\\b`).test(texto))) {
    return { intencion: 'ayuda', entendido: 'Se pidió una acción, y este modo solo consulta' };
  }

  for (const p of PATRONES) {
    if (p.claves.some((c) => texto.includes(c))) {
      return { intencion: p.intencion, entendido: p.entendido };
    }
  }

  return { intencion: 'ayuda', entendido: 'No entendí la pregunta' };
}

/** Lo que el modo sabe responder, en palabras de supervisor. */
export const PREGUNTAS_DE_EJEMPLO = [
  '¿Cómo va el inventario de esta bodega?',
  '¿Qué falta por resolver?',
  '¿Qué se envió al sistema central?',
] as const;
