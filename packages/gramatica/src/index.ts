import { FRACCIONES_VERBALES, leerNumero } from './numeros';
import { esPalabraDeUnidad, leerUnidad, type UnidadCanonica } from './unidades';

export * from './numeros';
export * from './unidades';

/**
 * F-26 · La gramática determinista. El corazón del 90% sin LLM.
 *
 * El turno del Operador es *"platos cuadrados, tres unidades"*: un NOMBRE
 * seguido de una COLA NUMÉRICA. Separar esas dos partes es gramática, no
 * juicio; resolver el nombre contra un catálogo cerrado es búsqueda, no
 * generación. Ninguna de las dos necesita un modelo de lenguaje, y la
 * Restricción Técnica 1 prohíbe delegar a un modelo lo que es una condición.
 *
 * Corre EN EL DISPOSITIVO y en el servidor. Por eso vive en un paquete
 * compartido: si solo estuviera en el servidor, un microcorte de Wi-Fi
 * impediría contar, no solo enviar.
 */

export type FalloParse =
  | 'fraccion_verbal'
  | 'sin_cantidad'
  | 'sin_nombre'
  | 'unidad_no_soportada'
  | 'vacio';

export interface Segmentacion {
  readonly nombre: string;
  readonly cantidad: number;
  readonly unidad: UnidadCanonica;
}

export type ResultadoParse =
  | {
      readonly ok: true;
      readonly nombre: string;
      readonly cantidad: number;
      readonly unidad: UnidadCanonica;
      /**
       * El nombre extraído TERMINA en algo que parece una cantidad
       * ("aceite de oliva 10 ml"). La gramática no puede resolverlo: puede ser
       * parte del nombre del artículo —el catálogo real tiene
       * `ACEITE DE OLIVA 10ML /BOLS`— o una cantidad que el operario dijo de
       * más.
       *
       * Es una pregunta para el catálogo, no para la gramática. Quien resuelve
       * el nombre debe probar las DOS lecturas y, si ambas dan un artículo
       * plausible, presentar candidatos en vez de elegir (FR-1.27).
       */
      readonly nombreLlevaCantidad: boolean;
    }
  | {
      readonly ok: false;
      readonly motivo: FalloParse;
      readonly detalle?: string;
    };

/** Sin tildes, sin puntuación de sobra, en minúsculas. Igual que el catálogo. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[;:!?"']/g, ' ')
    .replace(/,(?!\d)/g, ' ') // la coma separa, salvo cuando es decimal
    .replace(/\s+/g, ' ')
    .trim();
}

export function parsear(texto: string): ResultadoParse {
  const limpio = normalizar(texto);
  if (!limpio) return { ok: false, motivo: 'vacio' };

  const palabras = limpio.split(' ');

  if (palabras.some((p) => FRACCIONES_VERBALES.includes(p))) {
    return {
      ok: false,
      motivo: 'fraccion_verbal',
      detalle: 'Se requiere un número exacto: "medio", "un cuarto" y similares no se aceptan (FR-1.9).',
    };
  }

  // Se prueba la cola MÁS LARGA primero y gana la primera válida.
  //
  // Al revés —la más corta— "ciento veintitres kilos" se partiría en
  // "veintitres kilos" dejando "ciento" pegado al nombre, y "dos mil unidades"
  // daría 1000. La cola larga es siempre la lectura correcta del número.
  let elegida: Segmentacion | null = null;

  for (let corte = 0; corte < palabras.length; corte += 1) {
    const s = intentarCola(palabras.slice(0, corte), palabras.slice(corte));

    if (s === 'fraccion') return { ok: false, motivo: 'fraccion_verbal' };
    if (s === 'unidad_no_soportada') {
      return {
        ok: false,
        motivo: 'unidad_no_soportada',
        detalle: 'La unidad dicha no está en el catálogo. No se convierte por cuenta propia.',
      };
    }
    if (s) {
      elegida = s;
      break;
    }
  }

  if (!elegida) {
    return {
      ok: false,
      motivo: 'sin_cantidad',
      detalle: 'No se entendió una cantidad con su unidad.',
    };
  }

  if (!elegida.nombre) {
    return {
      ok: false,
      motivo: 'sin_nombre',
      detalle: 'Se entendió la cantidad pero no qué artículo es.',
    };
  }

  return {
    ok: true,
    nombre: elegida.nombre,
    cantidad: elegida.cantidad,
    unidad: elegida.unidad,
    nombreLlevaCantidad: terminaEnCantidad(elegida.nombre),
  };
}

/** ¿El nombre extraído termina en `<número> <algo de unidad>`? */
function terminaEnCantidad(nombre: string): boolean {
  const p = nombre.split(' ');
  if (p.length < 2) return false;

  const ultima = p[p.length - 1]!;
  const penultima = p[p.length - 2]!;

  return esPalabraDeUnidad(ultima) && leerNumero([penultima]).ok;
}

type IntentoCola = Segmentacion | 'fraccion' | 'unidad_no_soportada' | null;

/** Una cola válida es exactamente `<número> <unidad>`, sin sobras. */
function intentarCola(nombre: readonly string[], cola: readonly string[]): IntentoCola {
  const numero = leerNumero(cola);
  if (!numero.ok) return numero.motivo === 'fraccion_verbal' ? 'fraccion' : null;

  const resto = cola.slice(numero.consumidos);
  if (resto.length !== 1) return null; // sobra o falta algo: no es una cola limpia

  const unidad = leerUnidad(resto[0]);
  if (unidad.tipo === 'no_soportada') return 'unidad_no_soportada';
  if (unidad.tipo === 'desconocida') return null;

  return {
    nombre: nombre.join(' ').replace(/[,\s]+$/, ''),
    cantidad: numero.valor,
    unidad: unidad.unidad,
  };
}

/**
 * ¿La gramática resolvió el turno? Es la métrica de F-27.
 *
 * Cuando cae por debajo del 85% la respuesta correcta es **ampliar la
 * gramática**, no mandar más turnos al modelo. Que el LLM haga menos es la
 * mejora; que sea más barato, no.
 */
export function cubierto(resultado: ResultadoParse): boolean {
  // Un nombre que arrastra una cantidad NO cuenta como cubierto: hay que
  // preguntarle al catálogo, y eso es trabajo humano potencial.
  return resultado.ok && !resultado.nombreLlevaCantidad;
}

export { esPalabraDeUnidad };
