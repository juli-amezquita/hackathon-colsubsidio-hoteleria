import { normalizar } from '@cci/gramatica';

/**
 * H5-01 · Criterios OBJETIVOS de descripción detallada (FR-5.2).
 *
 * El requisito dice que el sistema debe rechazar descripciones genéricas, y ahí
 * hay una trampa: "genérica" suena a juicio semántico, y juzgar semántica
 * pediría un modelo. La Restricción Técnica 1 lo prohíbe, y con razón — un
 * modelo que rechaza el trabajo de un operario a las seis de la mañana, por
 * motivos que nadie puede reproducir, es una función que se desactiva la
 * primera semana.
 *
 * Así que no se juzga la calidad: se comprueban condiciones. Longitud, palabras
 * distintas, y cuántas de ellas aportan algo. Un umbral se puede discutir con
 * el cliente; una opinión de modelo, no.
 *
 * Los umbrales son PROVISIONALES (G-4): el negocio los confirma. Están todos
 * juntos aquí arriba para que cambiarlos sea cambiar tres números.
 */

const LARGO_MINIMO = 20;
const PALABRAS_MINIMAS = 4;
const PALABRAS_UTILES_MINIMAS = 2;

/**
 * Palabras que por sí solas no describen nada.
 *
 * No es un filtro de groserías ni una lista de "palabras malas": son términos
 * que aparecen en CUALQUIER hallazgo y por tanto no distinguen este de otro.
 * "Caja grande de producto" tiene cuatro palabras y no dice qué hay dentro.
 */
const GENERICAS = new Set([
  'producto', 'productos', 'articulo', 'articulos', 'item', 'items',
  'cosa', 'cosas', 'algo', 'varios', 'varias', 'otro', 'otra', 'otros', 'otras',
  'caja', 'cajas', 'bolsa', 'bolsas', 'paquete', 'paquetes', 'unidad', 'unidades',
  'grande', 'grandes', 'pequeno', 'pequenos', 'mediano', 'medianos',
  'desconocido', 'desconocida', 'sin', 'nombre', 'marca', 'no', 'se', 'sabe',
  // Deícticos: señalan, no describen. "Esto que está aquí" tiene tres palabras
  // largas y cero información para quien lea el hallazgo mañana.
  'esto', 'eso', 'aquello', 'aqui', 'aca', 'alli', 'alla', 'ahi',
  'esta', 'este', 'hay', 'que', 'de', 'del', 'la', 'el', 'los', 'las', 'un',
  'una', 'unos', 'unas', 'con', 'y', 'en', 'por', 'para', 'mas', 'menos',
]);

export interface Veredicto {
  readonly aceptada: boolean;
  /** Qué le falta, en términos accionables. Se le muestra al operario. */
  readonly motivo: string | null;
}

export function evaluarDescripcion(texto: string): Veredicto {
  const limpio = texto.trim();

  if (limpio.length < LARGO_MINIMO) {
    return {
      aceptada: false,
      motivo: `La descripción debe tener al menos ${LARGO_MINIMO} caracteres. Diga qué es, de qué marca y en qué presentación.`,
    };
  }

  const palabras = normalizar(limpio).split(/\s+/).filter(Boolean);
  const distintas = new Set(palabras);

  if (distintas.size < PALABRAS_MINIMAS) {
    return {
      aceptada: false,
      motivo: `Use al menos ${PALABRAS_MINIMAS} palabras distintas. Repetir la misma no agrega detalle.`,
    };
  }

  // Lo que de verdad distingue un hallazgo de otro: las palabras que no
  // aparecerían en cualquier descripción.
  const utiles = [...distintas].filter((p) => !GENERICAS.has(p) && p.length > 2);

  if (utiles.length < PALABRAS_UTILES_MINIMAS) {
    return {
      aceptada: false,
      motivo:
        'La descripción es demasiado genérica. Agregue datos que distingan el producto: marca, sabor, color, presentación o tamaño.',
    };
  }

  return { aceptada: true, motivo: null };
}
