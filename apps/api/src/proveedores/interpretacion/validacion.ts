import { FRACCIONES_VERBALES, normalizar } from '@cci/gramatica';

import { UMBRAL_CONFIANZA, type PropuestaInterpretacion } from './proveedor';

/**
 * F-29 · La salida del modelo VUELVE a la validación determinista.
 *
 * El modelo propone; el código dispone. Es la Restricción Técnica 1 llevada a
 * su consecuencia práctica: aunque el modelo intervenga en el ~10% de turnos,
 * **nada de lo que dice se guarda sin comprobarse contra una condición**.
 *
 * Lo que se comprueba, y por qué cada cosa:
 *
 *   · El nombre existe LITERALMENTE en el catálogo. Un modelo puede alucinar
 *     un artículo plausible que no existe; el catálogo es la autoridad.
 *   · La cantidad es un número finito y no negativa. No hay conteo negativo.
 *   · La unidad es una de las cuatro del inventario real.
 *   · No se coló una fracción verbal (FR-1.9).
 *   · La confianza supera el umbral. Preguntar es barato.
 *
 * Cualquier fallo se traduce en "pregúntale al operario", nunca en un valor
 * corregido por nuestra cuenta.
 */

export type Veredicto =
  | { readonly aceptada: true; readonly nombre: string; readonly cantidad: number; readonly unidad: string }
  | { readonly aceptada: false; readonly motivo: string };

export function validarPropuesta(
  propuesta: PropuestaInterpretacion,
  catalogo: readonly string[],
): Veredicto {
  if (propuesta.confianza < UMBRAL_CONFIANZA) {
    return { aceptada: false, motivo: `Confianza ${propuesta.confianza.toFixed(2)} bajo el umbral.` };
  }

  if (propuesta.nombre === null || propuesta.cantidad === null || propuesta.unidad === null) {
    return { aceptada: false, motivo: 'La propuesta está incompleta.' };
  }

  // El nombre se busca contra el catálogo NORMALIZADO, no por igualdad cruda:
  // un espacio doble o una tilde no deberían tumbar una propuesta correcta.
  // Pero el valor que se guarda es el del CATÁLOGO, nunca el del modelo.
  const objetivo = normalizar(propuesta.nombre);
  const real = catalogo.find((c) => normalizar(c) === objetivo);
  if (!real) {
    return { aceptada: false, motivo: 'El nombre propuesto no existe en el catálogo de la bodega.' };
  }

  if (!Number.isFinite(propuesta.cantidad) || propuesta.cantidad < 0) {
    return { aceptada: false, motivo: 'La cantidad no es un número válido.' };
  }

  const unidades = ['Unidad', 'Kilogram', 'Liter', 'Portion'];
  if (!unidades.includes(propuesta.unidad)) {
    return { aceptada: false, motivo: 'La unidad no pertenece al inventario.' };
  }

  // Cinturón: si una fracción verbal llegó hasta aquí, la gramática ya debió
  // rechazarla. Comprobarlo dos veces cuesta nada y cierra el camino por el
  // que un "medio kilo" podría entrar disfrazado de propuesta del modelo.
  if (propuesta.nota && FRACCIONES_VERBALES.some((f) => normalizar(propuesta.nota!).includes(f))) {
    return { aceptada: false, motivo: 'La propuesta menciona una fracción verbal (FR-1.9).' };
  }

  return { aceptada: true, nombre: real, cantidad: propuesta.cantidad, unidad: propuesta.unidad };
}
