import { parsear } from '@cci/gramatica'

import { unidadDesdeServidor, type Unit } from '@/lib/data'

/**
 * Interpretación del dictado. **Ahora usa la gramática real del sistema.**
 *
 * Este archivo tenía su propio diccionario de números en español y sus propias
 * unidades —`cajas`, `bultos`, `pacas`—. Funcionaba, pero era una segunda
 * implementación de la misma regla, y dos gramáticas divergen: la del
 * dispositivo aceptaba "dos cajas de arroz" y el servidor rechazaría esa
 * unidad, con el operario sin entender por qué.
 *
 * `@cci/gramatica` es la MISMA que corre en el servidor —mismo paquete, mismas
 * 32 pruebas—, y por eso el dispositivo puede resolver sin red sabiendo que el
 * servidor va a concluir lo mismo (F-21b, FR-2.5).
 *
 * Lo que se gana además de la coherencia:
 *
 *   · **Las fracciones verbales se rechazan.** "Medio bulto" no es una
 *     cantidad, es una estimación, y un inventario no se cuenta estimando.
 *     Antes se aceptaba en silencio.
 *   · **Las unidades no soportadas se nombran.** Si alguien dice "gramos", no
 *     se convierten por cuenta propia a kilos —convertir en silencio es como
 *     se pierde un factor de mil— sino que se dice.
 *   · **`nombreLlevaCantidad`** avisa cuando el nombre termina en algo que
 *     parece cifra. El catálogo real tiene `ACEITE DE OLIVA 10ML /BOLS`: ahí
 *     "10 ml" es parte del nombre, no lo que el operario contó.
 */

export interface ParsedSpeech {
  name: string
  quantity: number | null
  unit: Unit | null
  /** El sistema no lo resolvió solo: hay que confirmarlo en pantalla. */
  needsReview: boolean
  /** Por qué no se resolvió, en palabras para el operario. */
  reason: string | null
}

const MOTIVOS: Record<string, string> = {
  fraccion_verbal:
    'Dijo una fracción ("medio", "un cuarto"). Un inventario necesita una cantidad exacta.',
  sin_cantidad: 'No se entendió la cantidad. Dígala otra vez o escríbala.',
  sin_nombre: 'No se entendió el nombre del producto.',
  unidad_no_soportada:
    'Esa unidad no está en el catálogo. Use unidades, kilogramos, litros o porciones.',
  vacio: 'No se escuchó nada.',
}

export function parseSpeech(transcript: string): ParsedSpeech {
  const r = parsear(transcript)

  if (!r.ok) {
    // El dictado admite dos lecturas y ninguna es más correcta: se dicen las
    // dos y decide la persona (FR-1.27).
    if (r.motivo === 'ambiguo' && r.lecturas?.length === 2) {
      const [a, b] = r.lecturas
      return {
        name: transcript.trim(),
        quantity: null,
        unit: null,
        needsReview: true,
        reason:
          `Se puede entender de dos formas: ${a!.cantidad} de "${a!.nombre}", ` +
          `o ${b!.cantidad} de "${b!.nombre}". Confirme cuál.`,
      }
    }

    return {
      // Se conserva lo dictado: el operario corrige sobre lo que dijo, no
      // sobre una pantalla en blanco.
      name: transcript.trim(),
      quantity: null,
      unit: null,
      needsReview: true,
      reason: r.detalle ?? MOTIVOS[r.motivo] ?? 'No se entendió el dictado.',
    }
  }

  return {
    name: r.nombre,
    quantity: r.cantidad,
    // `null` cuando el operario no dijo unidad ("diez papas"): la pone el
    // artículo del catálogo, no esta función.
    unit: r.unidad ? unidadDesdeServidor(r.unidad) : null,
    // Si el nombre termina en algo que parece cantidad, la gramática no puede
    // decidirlo sola: lo decide la persona mirando el catálogo.
    needsReview: r.nombreLlevaCantidad,
    reason: r.nombreLlevaCantidad
      ? 'El nombre termina en una cifra. Confirme si es parte del producto o la cantidad.'
      : null,
  }
}
