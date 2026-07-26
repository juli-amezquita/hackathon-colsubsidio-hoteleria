import { createHash } from 'node:crypto';

import { normalizar } from '@cci/gramatica';

import type { SenalesDeCaptura } from '../../platform/dominio/senales';

/**
 * De las señales a propuestas concretas.
 *
 * Función pura: entran las señales, salen las propuestas. Se prueba sin base y
 * sin red, que es lo que permite discutir el criterio mirando los umbrales en
 * vez de ejecutando el sistema entero.
 *
 * ⚠️ **Ninguna propuesta se aplica sola.** Van a un panel donde una persona las
 * aprueba con la evidencia delante. Es la misma regla del árbitro y del
 * Auditor: el sistema ordena y propone, una persona dispone. Un bucle que se
 * aplicara a sí mismo optimizaría hacia no molestar —las alertas son
 * fricción— y acabaría apagando el control con todas las métricas en verde.
 */

export type TipoPropuesta = 'alias' | 'gramatica' | 'confusion_numerica' | 'catalogo';

export interface Propuesta {
  readonly tipo: TipoPropuesta;
  /**
   * Identidad estable, derivada del CONTENIDO y no del texto.
   *
   * El texto de la acción lleva el número de repeticiones dentro, así que
   * cambia en cuanto llega una más. Si la identidad dependiera de él, una
   * propuesta rechazada volvería a aparecer como nueva a la semana siguiente —
   * y un panel que insiste con lo que ya le dijeron que no se deja de leer.
   */
  readonly huella: string;
  /** Qué hacer, en una frase que una persona pueda aprobar o rechazar. */
  readonly accion: string;
  /** Por qué. Con números, no con adjetivos. */
  readonly evidencia: string;
  /** Cuántas veces ocurrió lo que la respalda. Ordena la lista. */
  readonly veces: number;
  /** Datos para aplicarla. `null` cuando la propuesta es para una persona. */
  readonly aplicable: { readonly articuloId: string; readonly bodegaId: string; readonly alias: string } | null;
}

/**
 * Cuántas veces tiene que repetirse una desambiguación para proponerla.
 *
 * Con dos podría ser casualidad —dos operarios distintos, dos días distintos—;
 * con tres es un patrón. El número es discutible y por eso está aquí arriba y
 * no enterrado en una consulta.
 */
const MINIMO_DESAMBIGUACIONES = 3;

/** Y cuántas veces un texto tiene que derrotar a la gramática. */
const MINIMO_TEXTOS = 2;

export function proponer(
  senales: SenalesDeCaptura,
  aliasExistentes: ReadonlySet<string>,
): Propuesta[] {
  const propuestas: Propuesta[] = [];

  // ── 1. Alias ──────────────────────────────────────────────────────────────
  //
  // La más rentable de todas y la que el código ya venía pidiendo: cuando la
  // desambiguación manual sube, la mejora barata es poblar la tabla de alias,
  // no tocar el algoritmo.
  //
  // Y no inventa nada: cada alias propuesto es lo que N personas YA decidieron
  // a mano. El sistema solo se está dando cuenta.
  for (const d of senales.desambiguaciones) {
    const alias = normalizar(d.texto);
    if (d.veces < MINIMO_DESAMBIGUACIONES || !alias) continue;
    if (aliasExistentes.has(`${d.bodegaId}|${alias}`)) continue;

    propuestas.push({
      tipo: 'alias',
      huella: huella('alias', d.bodegaId, d.articuloId, alias),
      accion: `Registrar "${d.texto}" como alias de ${d.articulo}`,
      evidencia: `${d.veces} operarios lo eligieron a mano de la lista de candidatos`,
      veces: d.veces,
      aplicable: { articuloId: d.articuloId, bodegaId: d.bodegaId, alias },
    });
  }

  // ── 2. Gramática ──────────────────────────────────────────────────────────
  //
  // Cada texto que la gramática no resolvió es un caso de prueba que le falta.
  // Esto NO se aplica solo: se convierte en código y tests, que es donde el
  // pulido es permanente y no cuesta por llamada.
  for (const t of senales.textosSinResolver) {
    if (t.veces < MINIMO_TEXTOS) continue;
    propuestas.push({
      tipo: 'gramatica',
      huella: huella('gramatica', normalizar(t.texto)),
      accion: `Agregar "${t.texto}" a las pruebas de la gramática`,
      evidencia: `La gramática no lo resolvió ${t.veces} veces; se resolvió por ${t.origenParse}`,
      veces: t.veces,
      aplicable: null,
    });
  }

  // ── 3. Confusiones numéricas ──────────────────────────────────────────────
  //
  // Aquí está el caso de "34 en vez de 24". Un keyterm no lo arregla: es una
  // confusión acústica entre dígitos, no entre palabras. Lo que sí se puede es
  // MEDIRLA — y si una pareja se repite, hay evidencia para pedir confirmación
  // específica en vez de suponer.
  for (const [par, casos] of agrupar(senales.correccionesNumericas)) {
    if (casos.length < MINIMO_TEXTOS) continue;
    const [antes, despues] = par.split('→');
    propuestas.push({
      tipo: 'confusion_numerica',
      huella: huella('confusion', par),
      accion: `Revisar la confusión ${antes} → ${despues}: pedir confirmación explícita cuando se dicte ${antes}`,
      evidencia: `${casos.length} correcciones con el mismo par; difieren en un solo dígito`,
      veces: casos.length,
      aplicable: null,
    });
  }

  // ── 4. Catálogo ───────────────────────────────────────────────────────────
  if (senales.fantasmasConCandidatosDescartados >= MINIMO_TEXTOS) {
    propuestas.push({
      tipo: 'catalogo',
      huella: huella('catalogo', 'fantasmas-con-candidatos'),
      accion: 'Revisar si el catálogo maestro tiene artículos duplicados o mal nombrados',
      evidencia:
        `${senales.fantasmasConCandidatosDescartados} hallazgos se reportaron como no registrados ` +
        'pese a que el sistema ofreció artículos parecidos',
      veces: senales.fantasmasConCandidatosDescartados,
      aplicable: null,
    });
  }

  return propuestas.sort((a, b) => b.veces - a.veces);
}

/**
 * La identidad de una propuesta.
 *
 * Se calcula sobre lo que la define —tipo, bodega, artículo, alias— y NUNCA
 * sobre la evidencia, que crece con cada repetición. Es lo que permite que el
 * reporte corra mil veces sin duplicar nada y que un rechazo se sostenga.
 */
function huella(...partes: readonly string[]): string {
  return createHash('sha256').update(partes.join('|')).digest('hex').slice(0, 32);
}

/**
 * Agrupa las correcciones por pareja de números, quedándose solo con las que
 * parecen una confusión al oír.
 *
 * El criterio es estrecho a propósito: misma cantidad de dígitos y diferencia
 * en uno solo. Contar 24 y corregir a 300 es un error de conteo, no de
 * escucha, y meterlo aquí ahogaría la señal que sí sirve.
 */
function agrupar(
  correcciones: SenalesDeCaptura['correccionesNumericas'],
): Map<string, SenalesDeCaptura['correccionesNumericas'][number][]> {
  const grupos = new Map<string, SenalesDeCaptura['correccionesNumericas'][number][]>();

  for (const c of correcciones) {
    const antes = entero(c.antes);
    const despues = entero(c.despues);
    if (!antes || !despues || !pareceConfusionAlOir(antes, despues)) continue;

    const clave = `${antes}→${despues}`;
    grupos.set(clave, [...(grupos.get(clave) ?? []), c]);
  }

  return grupos;
}

/** `"24.000"` → `"24"`. Descarta lo que no sea un entero limpio. */
function entero(valor: string): string | null {
  const n = Number(valor);
  return Number.isInteger(n) && n >= 0 ? String(n) : null;
}

function pareceConfusionAlOir(a: string, b: string): boolean {
  if (a === b || a.length !== b.length) return false;
  let distintos = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) distintos++;
  return distintos === 1;
}
