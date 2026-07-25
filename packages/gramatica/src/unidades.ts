/**
 * Diccionario de unidades: cómo se dicen, no cómo las llama el ERP.
 *
 * Las cuatro claves canónicas —`Unidad`, `Kilogram`, `Liter`, `Portion`— son
 * exactamente las que trae el inventario del cliente. Los sinónimos son la
 * forma hablada, en singular y plural, con y sin tilde, porque el operario dice
 * "kilos" y el sistema tiene "Kilogram".
 */

export type UnidadCanonica = 'Unidad' | 'Kilogram' | 'Liter' | 'Portion';

const SINONIMOS: Record<string, UnidadCanonica> = {
  unidad: 'Unidad', unidades: 'Unidad', und: 'Unidad', u: 'Unidad',
  pieza: 'Unidad', piezas: 'Unidad',

  kilo: 'Kilogram', kilos: 'Kilogram', kilogramo: 'Kilogram',
  kilogramos: 'Kilogram', kg: 'Kilogram', kgs: 'Kilogram',

  litro: 'Liter', litros: 'Liter', lt: 'Liter', lts: 'Liter', l: 'Liter',

  porcion: 'Portion', porciones: 'Portion',
};

/**
 * Unidades que la gente dice pero que NO están en el catálogo del cliente.
 *
 * No se convierten en silencio. "Quinientos gramos" son 0,5 kg, sí — pero
 * convertirlo por nuestra cuenta significaría escribir en el libro una cantidad
 * que el operario nunca dijo. Se reconoce, se marca, y decide la persona.
 */
const RECONOCIDAS_NO_SOPORTADAS: Record<string, string> = {
  gramo: 'Kilogram', gramos: 'Kilogram', g: 'Kilogram', gr: 'Kilogram',
  mililitro: 'Liter', mililitros: 'Liter', ml: 'Liter',
  caja: 'Unidad', cajas: 'Unidad', paquete: 'Unidad', paquetes: 'Unidad',
  bulto: 'Unidad', bultos: 'Unidad', rollo: 'Unidad', rollos: 'Unidad',
  bolsa: 'Unidad', bolsas: 'Unidad',
};

export type LecturaUnidad =
  | { readonly tipo: 'canonica'; readonly unidad: UnidadCanonica }
  | { readonly tipo: 'no_soportada'; readonly dicha: string; readonly relacionadaCon: string }
  | { readonly tipo: 'desconocida' };

export function leerUnidad(palabra: string | undefined): LecturaUnidad {
  if (!palabra) return { tipo: 'desconocida' };

  const canonica = SINONIMOS[palabra];
  if (canonica) return { tipo: 'canonica', unidad: canonica };

  const pariente = RECONOCIDAS_NO_SOPORTADAS[palabra];
  if (pariente) return { tipo: 'no_soportada', dicha: palabra, relacionadaCon: pariente };

  return { tipo: 'desconocida' };
}

export function esPalabraDeUnidad(palabra: string): boolean {
  return palabra in SINONIMOS || palabra in RECONOCIDAS_NO_SOPORTADAS;
}
