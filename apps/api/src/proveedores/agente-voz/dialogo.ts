import { parsear, type ResultadoParse } from '@cci/gramatica';

/**
 * El diálogo del conteo por voz. **Determinista de punta a punta.**
 *
 * Aquí se decide qué hace el sistema con lo que el operario dijo y qué le
 * responde. Ni una sola de esas dos decisiones la toma un modelo de lenguaje
 * (Restricción Técnica 1): el modelo es el oído y la boca, este archivo es el
 * criterio.
 *
 * El reparto importa y conviene decirlo sin ambigüedad:
 *
 *   · **Gemini transcribe** lo que entra por el micrófono. Eso es percepción, y
 *     es exactamente donde un modelo es mejor que cualquier regla.
 *   · **Esta máquina de estados decide** qué se entendió, si hace falta
 *     preguntar y qué se registra. Eso es una condición, y una condición no se
 *     delega.
 *   · **Gemini pronuncia** la frase que esta máquina redactó, palabra por
 *     palabra. No la reformula ni la mejora.
 *
 * Si el modelo alucina, alucina en el texto que oyó — y ahí la gramática lo
 * rechaza o el catálogo no lo resuelve. Nunca alucina una cantidad registrada,
 * porque la cantidad no pasa por él.
 */

export type Fase =
  | { readonly tipo: 'esperando' }
  | { readonly tipo: 'confirmando'; readonly item: ItemEnCurso }
  | { readonly tipo: 'eligiendo'; readonly candidatos: readonly Candidato[]; readonly item: ItemEnCurso }
  /**
   * Se dictó algo que el catálogo no tiene. Historia 5: no se descarta, se
   * ofrece registrarlo como HALLAZGO.
   *
   * Es una fase propia y no un `confirmando` con bandera porque lo que se
   * confirma es distinto: aquí el operario no está diciendo "sí, son diez", está
   * diciendo "sí, esto existe y no está en tu lista". Un producto fantasma es
   * una afirmación sobre el catálogo, no sobre una cantidad.
   */
  | { readonly tipo: 'ofreciendo_hallazgo'; readonly item: ItemEnCurso }
  /** Alerta de discrepancia sin responder. Sin ella no se puede cerrar (FR-2.4). */
  | { readonly tipo: 'resolviendo_alerta'; readonly item: ItemEnCurso; readonly registroId: string };

export interface Candidato {
  readonly articuloId: string;
  readonly nombre: string;
}

export interface ItemEnCurso {
  readonly articuloId: string | null;
  readonly nombre: string;
  readonly cantidad: number;
  /** `null` cuando el operario no dijo unidad: la pone el catálogo. */
  readonly unidad: string | null;
  readonly dictado: string;
}

export type Accion =
  | { readonly tipo: 'hablar'; readonly texto: string }
  | { readonly tipo: 'registrar'; readonly item: ItemEnCurso; readonly texto: string }
  /** Producto físico sin correspondencia en el catálogo (Historia 5, FR-5.x). */
  | { readonly tipo: 'registrar_hallazgo'; readonly item: ItemEnCurso; readonly texto: string }
  /** El operario sostiene su conteo pese a la alerta (FR-2.4). */
  | { readonly tipo: 'sostener'; readonly registroId: string; readonly texto: string }
  | { readonly tipo: 'callar' };

/** Lo que el operario dice para aceptar. Cerrado a propósito. */
const AFIRMA = new Set([
  'si', 'sí', 'correcto', 'confirmo', 'exacto', 'listo', 'ok', 'okey', 'dale',
  'eso es', 'así es', 'asi es', 'afirmativo',
]);

/** Y para rechazar. Un "no" nunca se interpreta como duda. */
const NIEGA = new Set([
  'no', 'negativo', 'incorrecto', 'mal', 'corrige', 'corregir', 'otra vez',
  'repetir', 'cancelar', 'borra', 'borrar',
]);

const CANCELA = new Set(['cancelar', 'olvidalo', 'olvídalo', 'déjalo', 'dejalo']);

/**
 * Cómo pide un operario que algo quede como hallazgo.
 *
 * El sistema ya lo ofrecía —"repítelo o regístralo como hallazgo"— y no sabía
 * recibir la respuesta: el operario decía "márcalo como hallazgo" y el agente
 * lo trataba como un dictado nuevo. Ofrecer algo que uno no sabe aceptar es
 * peor que no ofrecerlo.
 *
 * Se busca por SUBCADENA y no por igualdad porque esto se dice de muchas
 * formas: "márcalo como hallazgo", "regístralo", "sí, es un hallazgo",
 * "producto nuevo".
 */
const PIDE_HALLAZGO = [
  'hallazgo', 'fantasma', 'no esta en la lista', 'no está en la lista',
  'producto nuevo', 'registralo', 'regístralo', 'marcalo', 'márcalo',
];

function pideHallazgo(dicho: string): boolean {
  return PIDE_HALLAZGO.some((p) => dicho.includes(limpio(p)));
}

function limpio(t: string): string {
  return t
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[.,;:!?¿¡"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Cómo se le lee un número al operario.
 *
 * En cifras y no en palabras: la voz sintética lee "24" como "veinticuatro" sin
 * ayuda, y escribirlo en letras arriesga que lea "veinte cuatro". Los decimales
 * se dicen con coma, que es como se dicen en Colombia.
 */
export function decirCantidad(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n).replace('.', ',');
}

const NOMBRE_UNIDAD: Record<string, [string, string]> = {
  Unidad: ['unidad', 'unidades'],
  Kilogram: ['kilo', 'kilos'],
  Liter: ['litro', 'litros'],
  Portion: ['porción', 'porciones'],
};

export function decirUnidad(unidad: string | null, cantidad: number): string {
  const par = unidad ? NOMBRE_UNIDAD[unidad] : undefined;
  if (!par) return '';
  return ` ${cantidad === 1 ? par[0] : par[1]}`;
}

/** La frase de confirmación. Es la que el operario oye antes de que se guarde. */
export function fraseDeConfirmacion(item: ItemEnCurso): string {
  return `${item.nombre}, ${decirCantidad(item.cantidad)}${decirUnidad(item.unidad, item.cantidad)}. ¿Confirmas?`;
}

/**
 * Un turno del operario.
 *
 * `resolver` es la búsqueda por similitud sobre el catálogo cerrado de la
 * bodega. Se pasa como función para que esta máquina no sepa de base de datos y
 * se pueda probar entera sin levantar nada.
 */
export type Resolver = (nombre: string) => Promise<{
  articulo: Candidato | null;
  candidatos: readonly Candidato[];
  unidadEsperada: string | null;
}>;

export async function avanzar(
  fase: Fase,
  dictado: string,
  resolver: Resolver,
): Promise<{ readonly fase: Fase; readonly accion: Accion }> {
  const dicho = limpio(dictado);
  if (!dicho) return { fase, accion: { tipo: 'callar' } };

  // ── Estaba esperando confirmación ────────────────────────────────────────
  if (fase.tipo === 'confirmando') {
    if (AFIRMA.has(dicho)) {
      return {
        fase: { tipo: 'esperando' },
        accion: {
          tipo: 'registrar',
          item: fase.item,
          texto: `Registrado. ${fase.item.nombre}.`,
        },
      };
    }
    if (CANCELA.has(dicho)) {
      return { fase: { tipo: 'esperando' }, accion: { tipo: 'hablar', texto: 'Cancelado. Siguiente.' } };
    }
    if (NIEGA.has(dicho)) {
      return { fase: { tipo: 'esperando' }, accion: { tipo: 'hablar', texto: 'Listo, dímelo otra vez.' } };
    }
    // No dijo ni sí ni no: probablemente ya está dictando el siguiente. Se
    // trata como turno nuevo y NO se registra el anterior — un artículo sin
    // confirmar no entra al inventario.
    return interpretarDictado(dictado, resolver, 'El anterior no quedó. ');
  }

  // ── Se le ofreció registrarlo como hallazgo ──────────────────────────────
  if (fase.tipo === 'ofreciendo_hallazgo') {
    if (AFIRMA.has(dicho) || pideHallazgo(dicho)) {
      return {
        fase: { tipo: 'esperando' },
        accion: {
          tipo: 'registrar_hallazgo',
          item: fase.item,
          texto: `Anotado como hallazgo: ${fase.item.nombre}. Lo revisa el auditor.`,
        },
      };
    }
    if (NIEGA.has(dicho) || CANCELA.has(dicho)) {
      return { fase: { tipo: 'esperando' }, accion: { tipo: 'hablar', texto: 'Listo, no lo anoto. Sigue.' } };
    }
    return interpretarDictado(dictado, resolver);
  }

  // ── Hay una alerta sin responder ─────────────────────────────────────────
  //
  // El operario decide: sostiene su conteo o lo vuelve a contar. Lo que NO se
  // le dice es en qué dirección falla ni por cuánto (FR-2.2) — decírselo
  // convertiría el conteo ciego en un conteo guiado.
  if (fase.tipo === 'resolviendo_alerta') {
    if (AFIRMA.has(dicho) || dicho.includes('sostengo') || dicho.includes('seguro')) {
      return {
        fase: { tipo: 'esperando' },
        accion: {
          tipo: 'sostener',
          registroId: fase.registroId,
          texto: `Queda tu conteo de ${fase.item.nombre}. El auditor lo revisa.`,
        },
      };
    }
    if (NIEGA.has(dicho) || dicho.includes('cuento') || dicho.includes('contar')) {
      return {
        fase: { tipo: 'esperando' },
        accion: { tipo: 'hablar', texto: `Listo, cuenta ${fase.item.nombre} otra vez y dímelo.` },
      };
    }
    return interpretarDictado(dictado, resolver);
  }

  // ── Estaba eligiendo entre candidatos ────────────────────────────────────
  if (fase.tipo === 'eligiendo') {
    const elegido = porOrdinal(dicho, fase.candidatos) ?? porNombre(dicho, fase.candidatos);
    if (elegido) {
      const item: ItemEnCurso = { ...fase.item, articuloId: elegido.articuloId, nombre: elegido.nombre };
      return {
        fase: { tipo: 'confirmando', item },
        accion: { tipo: 'hablar', texto: fraseDeConfirmacion(item) },
      };
    }
    if (CANCELA.has(dicho) || NIEGA.has(dicho)) {
      return { fase: { tipo: 'esperando' }, accion: { tipo: 'hablar', texto: 'Listo, dímelo otra vez.' } };
    }
    return interpretarDictado(dictado, resolver);
  }

  return interpretarDictado(dictado, resolver);
}

async function interpretarDictado(
  dictado: string,
  resolver: Resolver,
  prefijo = '',
): Promise<{ readonly fase: Fase; readonly accion: Accion }> {
  const r: ResultadoParse = parsear(dictado);

  if (!r.ok) {
    return { fase: { tipo: 'esperando' }, accion: { tipo: 'hablar', texto: prefijo + motivo(r) } };
  }

  const { articulo, candidatos, unidadEsperada } = await resolver(r.nombre);

  const item: ItemEnCurso = {
    articuloId: articulo?.articuloId ?? null,
    nombre: articulo?.nombre ?? r.nombre,
    cantidad: r.cantidad,
    // Si no dijo unidad, la del catálogo. No es adivinar: el artículo la
    // declara, y no decirla es lo normal cuando solo hay una posible.
    unidad: r.unidad ?? unidadEsperada,
    dictado,
  };

  if (!articulo) {
    if (candidatos.length === 0) {
      // Se OFRECE y se queda esperando la respuesta. Antes se ofrecía y se
      // volvía a 'esperando': el operario decía "márcalo como hallazgo" y el
      // agente lo interpretaba como un producto llamado "márcalo como
      // hallazgo". Ofrecer algo que uno no sabe recibir es peor que callarse.
      return {
        fase: { tipo: 'ofreciendo_hallazgo', item },
        accion: {
          tipo: 'hablar',
          texto: `${prefijo}No encuentro ${r.nombre} en el catálogo de esta bodega. ¿Lo anoto como hallazgo para el auditor?`,
        },
      };
    }
    // Duda: se pregunta. El sistema NO elige por puntaje (FR-1.27).
    const lista = candidatos.slice(0, 3).map((c, i) => `${i + 1}, ${c.nombre}`).join('. ');
    return {
      fase: { tipo: 'eligiendo', candidatos: candidatos.slice(0, 3), item },
      accion: { tipo: 'hablar', texto: `${prefijo}¿Cuál de estos? ${lista}. Di el número.` },
    };
  }

  return {
    fase: { tipo: 'confirmando', item },
    accion: { tipo: 'hablar', texto: prefijo + fraseDeConfirmacion(item) },
  };
}

function motivo(r: Extract<ResultadoParse, { ok: false }>): string {
  switch (r.motivo) {
    case 'fraccion_verbal':
      return 'Necesito un número exacto, no "medio" ni "un cuarto".';
    case 'unidad_no_soportada':
      return 'Esa unidad no está en el catálogo. Usa unidades, kilos, litros o porciones.';
    case 'sin_nombre':
      return 'Entendí la cantidad pero no el producto.';
    case 'ambiguo': {
      const [a, b] = r.lecturas ?? [];
      return a && b
        ? `Eso lo puedo entender de dos formas: ${decirCantidad(a.cantidad)} de "${a.nombre}", o ${decirCantidad(b.cantidad)} de "${b.nombre}". Dímelo de otra manera.`
        : 'Eso lo puedo entender de dos formas. Dímelo de otra manera.';
    }
    case 'vacio':
      return 'No te escuché.';
    default:
      return 'No entendí la cantidad. Dime el producto y cuántos hay.';
  }
}

const ORDINALES: Record<string, number> = {
  '1': 0, uno: 0, primero: 0, primera: 0, la1: 0,
  '2': 1, dos: 1, segundo: 1, segunda: 1,
  '3': 2, tres: 2, tercero: 2, tercera: 2,
};

function porOrdinal(dicho: string, candidatos: readonly Candidato[]): Candidato | null {
  const i = ORDINALES[dicho.replace(/^(el|la|numero) /, '')];
  return i !== undefined ? (candidatos[i] ?? null) : null;
}

function porNombre(dicho: string, candidatos: readonly Candidato[]): Candidato | null {
  const exacto = candidatos.filter((c) => limpio(c.nombre).includes(dicho));
  // Solo si UNO coincide: si el dictado casa con dos candidatos, seguimos sin
  // saber cuál es, y elegir el primero sería exactamente lo que FR-1.27 prohíbe.
  return exacto.length === 1 ? exacto[0]! : null;
}
