/**
 * Números en español hablado.
 *
 * Deepgram Flux devuelve numerales formateados —"19.8" y no "diecinueve punto
 * ocho"— y por eso se eligió. Pero eso es una promesa de un proveedor, y la
 * Restricción 5 dice que ningún proveedor puede dejar al operario sin trabajar.
 * Si mañana se conmuta al adaptador simulado, a otro STT, o alguien digita en
 * letras, esto tiene que seguir funcionando.
 */

const UNIDADES: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
  trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17,
  dieciocho: 18, diecinueve: 19, veinte: 20, veintiuno: 21, veintiun: 21,
  veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24,
  veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28,
  veintinueve: 29,
};

const DECENAS: Record<string, number> = {
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60,
  setenta: 70, ochenta: 80, noventa: 90,
};

const CENTENAS: Record<string, number> = {
  cien: 100, ciento: 100, doscientos: 200, doscientas: 200,
  trescientos: 300, trescientas: 300, cuatrocientos: 400, cuatrocientas: 400,
  quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600,
  setecientos: 700, setecientas: 700, ochocientos: 800, ochocientas: 800,
  novecientos: 900, novecientas: 900,
};

/**
 * Fracciones verbales. **Se rechazan explícitamente** (FR-1.9): el SPEC exige
 * números exactos.
 *
 * No es purismo. "Medio kilo" son 500 g para una persona y 400 para otra según
 * el envase que tenga en la mano, y esa ambigüedad terminaría en una
 * discrepancia que el Auditor tendría que ir a resolver caminando.
 */
export const FRACCIONES_VERBALES = [
  'medio', 'media', 'mitad', 'cuarto', 'cuarta', 'tercio', 'tercia',
  'octavo', 'docena', 'par',
];

export type ResultadoNumero =
  | { readonly ok: true; readonly valor: number; readonly consumidos: number }
  | { readonly ok: false; readonly motivo: 'fraccion_verbal' | 'no_es_numero' };

/** Convierte una secuencia de palabras a número. Devuelve cuántas consumió. */
function cardinal(palabras: readonly string[]): { valor: number; consumidos: number } | null {
  let total = 0;
  let i = 0;
  let algo = false;

  // Millares: "dos mil", "mil"
  const miles = leerHasta999(palabras.slice(i));
  if (palabras[miles?.consumidos ?? 0] === 'mil') {
    total += (miles && miles.valor > 0 ? miles.valor : 1) * 1000;
    i = (miles?.consumidos ?? 0) + 1;
    algo = true;
  }

  const resto = leerHasta999(palabras.slice(i));
  if (resto && resto.consumidos > 0) {
    total += resto.valor;
    i += resto.consumidos;
    algo = true;
  }

  return algo ? { valor: total, consumidos: i } : null;
}

function leerHasta999(
  palabras: readonly string[],
): { valor: number; consumidos: number } | null {
  let total = 0;
  let i = 0;
  let algo = false;

  const c = palabras[0];
  if (c && c in CENTENAS) {
    total += CENTENAS[c]!;
    i = 1;
    algo = true;
  }

  const d = palabras[i];
  if (d && d in DECENAS) {
    total += DECENAS[d]!;
    i += 1;
    algo = true;

    // "treinta y cinco"
    if (palabras[i] === 'y') {
      const u = palabras[i + 1];
      if (u && u in UNIDADES) {
        total += UNIDADES[u]!;
        i += 2;
      }
    }
  } else if (d && d in UNIDADES) {
    total += UNIDADES[d]!;
    i += 1;
    algo = true;
  }

  return algo ? { valor: total, consumidos: i } : null;
}

/**
 * Un número escrito como se escribe en Colombia: punto de miles, coma decimal.
 *
 * Esto era un error de MIL VECES. La expresión anterior trataba el punto como
 * separador decimal, así que `1.500` —mil quinientas servilletas, tecleado o
 * transcrito tal cual por cualquier dictado en español— se leía como **1,5**.
 * Y salía con `ok: true`, o sea que el sistema no preguntaba nada: registraba
 * 1,5 unidades donde había 1.500 y el operario no tenía forma de corregirlo
 * repitiendo la frase, porque el resultado era siempre el mismo.
 *
 * Las reglas, en orden:
 *   · con los dos separadores, manda el ÚLTIMO — `1.500,25` → 1500.25
 *   · solo coma → decimal — `19,8` → 19.8
 *   · solo punto seguido de EXACTAMENTE tres dígitos → miles — `1.500` → 1500
 *   · solo punto con otra cantidad de dígitos → decimal — `19.8` → 19.8
 *
 * La tercera es la única discutible: `19.800` podría ser 19,8 kg escrito con
 * ceros de más. Se resuelve como 19.800 porque quien escribe decimales en
 * Colombia usa coma, y porque el caso que rompía el inventario era el otro.
 */
export function enNotacionColombiana(bruto: string): number | null {
  const punto = bruto.lastIndexOf('.');
  const coma = bruto.lastIndexOf(',');

  let limpio: string;
  if (punto !== -1 && coma !== -1) {
    const decimal = Math.max(punto, coma);
    limpio = `${bruto.slice(0, decimal).replace(/[.,]/g, '')}.${bruto.slice(decimal + 1)}`;
  } else if (coma !== -1) {
    limpio = `${bruto.slice(0, coma).replace(/[.,]/g, '')}.${bruto.slice(coma + 1)}`;
  } else if (punto !== -1) {
    const cola = bruto.slice(punto + 1);
    limpio = cola.length === 3 ? bruto.replace(/\./g, '') : `${bruto.slice(0, punto).replace(/\./g, '')}.${cola}`;
  } else {
    limpio = bruto;
  }

  if (!/^\d+(\.\d+)?$/.test(limpio)) return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

/**
 * Lee un número desde el inicio de las palabras: dígitos ("20", "1.500") o
 * cardinales en español, con decimales por "punto", "coma" o "con".
 */
export function leerNumero(palabras: readonly string[]): ResultadoNumero {
  const primera = palabras[0];
  if (!primera) return { ok: false, motivo: 'no_es_numero' };

  if (FRACCIONES_VERBALES.includes(primera)) return { ok: false, motivo: 'fraccion_verbal' };

  let entero: number;
  let i: number;

  // Dígitos: "20", "19,8", "1.500", "1.500,25"
  const digitos = /^(\d[\d.,]*)$/.exec(primera);
  if (digitos) {
    const leido = enNotacionColombiana(digitos[1]!);
    if (leido === null) return { ok: false, motivo: 'no_es_numero' };
    if (!Number.isInteger(leido)) return { ok: true, valor: leido, consumidos: 1 };
    entero = leido;
    i = 1;
  } else {
    const c = cardinal(palabras);
    if (!c) return { ok: false, motivo: 'no_es_numero' };
    entero = c.valor;
    i = c.consumidos;
  }

  // Decimales: "veinte punto cinco", "dos con quinientos", "20 coma 5"
  const separador = palabras[i];
  if (separador === 'punto' || separador === 'coma' || separador === 'con') {
    const siguiente = palabras[i + 1];

    // "dos kilos con medio" → fracción verbal, se rechaza igual.
    if (siguiente && FRACCIONES_VERBALES.includes(siguiente)) {
      return { ok: false, motivo: 'fraccion_verbal' };
    }

    const decimal = leerDecimal(palabras.slice(i + 1));
    if (decimal) {
      return { ok: true, valor: Number(`${entero}.${decimal.digitos}`), consumidos: i + 1 + decimal.consumidos };
    }
  }

  return { ok: true, valor: entero, consumidos: i };
}

/** Palabras de un solo dígito: las que se deletrean tras el separador decimal. */
const DIGITOS: Record<string, string> = {
  cero: '0', un: '1', uno: '1', una: '1', dos: '2', tres: '3', cuatro: '4',
  cinco: '5', seis: '6', siete: '7', ocho: '8', nueve: '9',
};

/**
 * La parte decimal se lee como DÍGITOS, no como cantidad.
 *
 * Dos formas conviven y ambas son naturales:
 *
 *   · Deletreada  — "cero punto cero seis" = 0,06. Se concatenan los dígitos,
 *     y por eso hay que consumirlos TODOS: leer solo el primero daría 0,0.
 *   · Como número — "dos con veinticinco" = 2,25, no 2 + 25.
 *
 * Se prueba primero la deletreada, que es la que aparece al pesar cosas
 * pequeñas y la que más se rompe si se lee mal.
 */
function leerDecimal(palabras: readonly string[]): { digitos: string; consumidos: number } | null {
  const primera = palabras[0];
  if (!primera) return null;

  if (/^\d+$/.test(primera)) return { digitos: primera, consumidos: 1 };

  let digitos = '';
  let i = 0;
  while (i < palabras.length) {
    const d = DIGITOS[palabras[i]!];
    if (d === undefined) break;
    digitos += d;
    i += 1;
  }

  // Un solo dígito puede ser el comienzo de un cardinal más largo
  // ("dos con veinticinco"): se prefiere el cardinal si consume más palabras.
  const c = cardinal(palabras);
  if (c && c.consumidos > i) return { digitos: String(c.valor), consumidos: c.consumidos };

  if (i > 0) return { digitos, consumidos: i };

  if (!c) return null;
  return { digitos: String(c.valor), consumidos: c.consumidos };
}
