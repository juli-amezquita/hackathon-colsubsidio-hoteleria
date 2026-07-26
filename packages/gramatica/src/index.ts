import { FRACCIONES_VERBALES, leerNumero } from './numeros';
import { esEmpaque, esPalabraDeUnidad, leerUnidad, type UnidadCanonica } from './unidades';

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
  | 'ambiguo'
  | 'fraccion_verbal'
  | 'sin_cantidad'
  | 'sin_nombre'
  | 'unidad_no_soportada'
  | 'vacio';

export interface Segmentacion {
  readonly nombre: string;
  readonly cantidad: number;
  /**
   * `null` cuando el operario NO dijo unidad: "diez papas".
   *
   * No es un fallo. El artículo del catálogo declara la suya, y en una bodega
   * donde las papas se cuentan por unidad, exigir que lo diga es pedirle que
   * repita lo que el sistema ya sabe. Quien resuelve el nombre la completa.
   *
   * Tiene además una consecuencia buena: la alerta de unidad equivocada
   * (FR-2.1) solo puede dispararse cuando el operario AFIRMÓ una unidad. Si no
   * afirmó nada, no hay nada que contradecir.
   */
  readonly unidad: UnidadCanonica | null;
}

export type ResultadoParse =
  | {
      readonly ok: true;
      readonly nombre: string;
      readonly cantidad: number;
      /** `null` si el operario no dijo unidad. Ver {@link Segmentacion.unidad}. */
      readonly unidad: UnidadCanonica | null;
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
      /**
       * Las dos lecturas, cuando el dictado admite ambas y no coinciden.
       *
       * "dos aceite de oliva 3 litros" puede ser *dos* envases del aceite de
       * tres litros, o *tres litros* de un producto llamado "dos aceite de
       * oliva". Las dos son gramaticalmente correctas y el sistema no tiene
       * cómo saber cuál quiso decir: pregunta (FR-1.27). Elegir la más probable
       * es exactamente la clase de acierto que un día se equivoca en silencio.
       */
      readonly lecturas?: readonly Segmentacion[];
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

  // Las dos formas de decir lo mismo, y las dos son español corriente:
  //
  //   · COLA  — "platos cuadrados, tres unidades"
  //   · CABEZA — "tres unidades de platos cuadrados"
  //
  // La versión anterior solo entendía la cola. En campo eso significaba que el
  // operario dictaba bien, el sistema respondía "no entendí la cantidad" y le
  // tocaba escribir a mano lo que acababa de decir — que es justo lo que este
  // sistema existe para evitar.
  const porCola = buscarCola(palabras);
  if (typeof porCola === 'string') return falloDeCola(porCola);

  const porCabeza = buscarCabeza(palabras);
  if (typeof porCabeza === 'string') return falloDeCola(porCabeza);

  // Si las dos formas leen y NO dicen lo mismo, el dictado es ambiguo de
  // verdad. No se prefiere una: se pregunta.
  if (porCola && porCabeza && !mismaLectura(porCola, porCabeza)) {
    return {
      ok: false,
      motivo: 'ambiguo',
      detalle: 'El dictado admite dos lecturas y ninguna es más correcta que la otra.',
      lecturas: [porCola, porCabeza],
    };
  }

  const elegida = porCola ?? porCabeza;

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

function mismaLectura(a: Segmentacion, b: Segmentacion): boolean {
  return a.cantidad === b.cantidad && a.unidad === b.unidad && a.nombre === b.nombre;
}

function falloDeCola(motivo: 'fraccion' | 'unidad_no_soportada'): ResultadoParse {
  return motivo === 'fraccion'
    ? { ok: false, motivo: 'fraccion_verbal' }
    : {
        ok: false,
        motivo: 'unidad_no_soportada',
        detalle: 'La unidad dicha no está en el catálogo. No se convierte por cuenta propia.',
      };
}

/**
 * `<nombre> <número> <unidad>` — la cola numérica.
 *
 * Se prueba la cola MÁS LARGA primero. Al revés, "ciento veintitres kilos" se
 * partiría en "veintitres kilos" dejando "ciento" pegado al nombre, y "dos mil
 * unidades" daría 1000.
 */
function buscarCola(palabras: readonly string[]): Segmentacion | 'fraccion' | 'unidad_no_soportada' | null {
  for (let corte = 0; corte < palabras.length; corte += 1) {
    const s = intentarCola(palabras.slice(0, corte), palabras.slice(corte));
    if (s === 'fraccion' || s === 'unidad_no_soportada') return s;
    if (s) return s;
  }
  return null;
}

/**
 * `<número> [unidad] [de] <nombre>` — la cantidad al principio.
 *
 * La unidad es opcional: "diez papas" es una frase completa y el catálogo sabe
 * en qué se cuentan las papas. El "de" se descarta si está.
 *
 * Lo que NO se hace: tratar una palabra desconocida como unidad. En este
 * catálogo "caja", "bolsa" y "paquete" aparecen en 70 NOMBRES de artículo
 * —`CAJA PARA PAPAS PAQ X100`—, así que leerlas como unidad convertiría un
 * producto en una medida.
 */
function buscarCabeza(palabras: readonly string[]): Segmentacion | 'fraccion' | 'unidad_no_soportada' | null {
  const numero = leerNumero(palabras);
  if (!numero.ok) return numero.motivo === 'fraccion_verbal' ? 'fraccion' : null;

  let resto = palabras.slice(numero.consumidos);
  if (resto.length === 0) return null; // solo un número: no hay artículo

  const unidad = leerUnidad(resto[0]);
  // Solo las medidas que exigirían CONVERSIÓN se rechazan: "quinientos gramos"
  // son 0,5 kg y hacer esa cuenta en silencio escribiría en el libro una cifra
  // que nadie dijo.
  if (unidad.tipo === 'no_soportada') return 'unidad_no_soportada';

  let canonica: UnidadCanonica | null = null;
  if (unidad.tipo === 'canonica') {
    canonica = unidad.unidad;
    resto = resto.slice(1);
  }
  // Si lo que sigue al número es un empaque —"diez PAQUETES de papas"— se queda
  // en el nombre y la unidad la pone el catálogo. Ver `EMPAQUES`.

  if (!canonica && !esEmpaque(resto[0] ?? '') && (resto[0] === 'de' || resto[0] === 'del')) {
    resto = resto.slice(1);
  } else if (canonica && (resto[0] === 'de' || resto[0] === 'del')) {
    resto = resto.slice(1);
  }

  const nombre = resto.join(' ').replace(/^[,\s]+|[,\s]+$/g, '');
  if (!nombre) return null;

  return { nombre, cantidad: numero.valor, unidad: canonica };
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
