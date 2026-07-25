import Anthropic from '@anthropic-ai/sdk';
import { Injectable } from '@nestjs/common';

import { config } from '../../config';
import type {
  EntradaInterpretacion,
  ProveedorDeInterpretacion,
  PropuestaInterpretacion,
  ResultadoInterpretacion,
} from './proveedor';

/**
 * F-28 · `claude-opus-5` con cacheo de prompt (D-09, D-17).
 *
 * El playbook heredado, aplicado íntegro:
 *
 *   · **Bloque estático** — instrucciones, catálogo de la bodega y ejemplos,
 *     marcado con `cache_control` TTL 1 h. Es idéntico durante toda la jornada
 *     y distinto entre bodegas: el caso de libro.
 *   · **Bloque dinámico** — el turno concreto, SIEMPRE al final.
 *
 * El orden de render es `tools → system → messages`, así que el punto de corte
 * va en el último bloque de `system`. **PROHIBIDO interpolar hora, UUID o ID de
 * sesión antes de ese punto**: invalidaría todo el prefijo y el ahorro sería
 * cero sin que nadie se entere.
 *
 * Con `claude-opus-5` el mínimo cacheable son 512 tokens —la mitad que en
 * Opus 4.8—, así que hasta el catálogo de la bodega más pequeña (55 artículos)
 * entra en caché.
 */
@Injectable()
export class InterpretacionAnthropic implements ProveedorDeInterpretacion {
  readonly nombre = 'anthropic';

  private cliente: Anthropic | undefined;

  /**
   * Esquema de salida estructurada. El modelo no puede devolver otra forma:
   * la validación ocurre en la capa de la API, así que un formato inesperado
   * no llega nunca al dominio.
   */
  private static readonly ESQUEMA = {
    type: 'object',
    properties: {
      nombre: {
        type: ['string', 'null'],
        description: 'Nombre EXACTO del catálogo, copiado carácter por carácter. null si ninguno corresponde.',
      },
      cantidad: { type: ['number', 'null'], minimum: 0 },
      unidad: { type: ['string', 'null'], enum: ['Unidad', 'Kilogram', 'Liter', 'Portion', null] },
      confianza: { type: 'number', minimum: 0, maximum: 1 },
      nota: { type: ['string', 'null'] },
    },
    required: ['nombre', 'cantidad', 'unidad', 'confianza', 'nota'],
    additionalProperties: false,
  } as const;

  private static readonly INSTRUCCIONES = `Eres el intérprete de excepciones de un sistema de conteo de inventario.
Recibes un turno de voz que una gramática determinista NO logró resolver.

Tu única tarea es proponer qué artículo, cantidad y unidad quiso decir el operario.

REGLAS QUE NO PUEDES ROMPER:
- El nombre que devuelvas debe existir LITERALMENTE en el catálogo, copiado carácter por carácter. Si ninguno corresponde, devuelve null.
- NO decides si el dato es válido, ni si la cantidad es razonable, ni si hay discrepancia. Eso lo resuelve el sistema.
- NO conviertes unidades. Si el operario dijo gramos y el catálogo usa kilogramos, devuelve unidad null y explícalo en la nota.
- Las fracciones verbales ("medio", "un cuarto") se rechazan: cantidad null, nota explicando.
- Si dudas entre dos artículos, baja la confianza. Preguntar es barato; un conteo equivocado no.

La confianza es tu estimación honesta, no una formalidad: por debajo de 0,8 el sistema le pregunta al operario en vez de guardar.`;

  async interpretar(entrada: EntradaInterpretacion): Promise<ResultadoInterpretacion> {
    const respuesta = await this.api().messages.create({
      model: 'claude-opus-5',
      max_tokens: 1024,

      // El parse de excepción no necesita razonar en profundidad: es
      // reconocimiento, no deliberación. `disabled` se acepta hasta `high`.
      thinking: { type: 'disabled' },
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: InterpretacionAnthropic.ESQUEMA },
      },

      system: [
        { type: 'text', text: InterpretacionAnthropic.INSTRUCCIONES },
        {
          // El catálogo va AL FINAL del bloque estático y lleva el punto de
          // corte: cachea instrucciones + catálogo juntos. TTL de 1 h porque
          // una jornada de conteo tiene huecos mayores a 5 min y el caché se
          // enfriaría; a 1 h el punto de equilibrio son 3 llamadas y aquí hay
          // miles.
          type: 'text',
          text: `CATÁLOGO DE LA BODEGA:\n${entrada.catalogo.join('\n')}`,
          cache_control: { type: 'ephemeral', ttl: '1h' },
        },
      ],

      // Lo único que cambia entre llamadas, después del punto de corte.
      messages: [{ role: 'user', content: `Turno dictado: "${entrada.textoDictado}"` }],
    });

    return {
      propuesta: this.leerPropuesta(respuesta),
      uso: {
        entrada: respuesta.usage.input_tokens,
        salida: respuesta.usage.output_tokens,
        escritosACache: respuesta.usage.cache_creation_input_tokens ?? 0,
        // Si esto es 0 entre peticiones a la misma bodega, hay un invalidador
        // silencioso en el prefijo. Se registra como métrica, no como log.
        leidosDeCache: respuesta.usage.cache_read_input_tokens ?? 0,
      },
    };
  }

  private leerPropuesta(respuesta: Anthropic.Message): PropuestaInterpretacion {
    const vacia: PropuestaInterpretacion = {
      nombre: null,
      cantidad: null,
      unidad: null,
      confianza: 0,
      nota: 'El modelo no devolvió una propuesta utilizable.',
    };

    // Una negativa del modelo no es un error del sistema: es un turno que
    // habrá que resolver preguntando.
    if (respuesta.stop_reason === 'refusal') {
      return { ...vacia, nota: 'El modelo declinó interpretar este turno.' };
    }

    const bloque = respuesta.content.find((b) => b.type === 'text');
    if (!bloque || bloque.type !== 'text') return vacia;

    try {
      const crudo: unknown = JSON.parse(bloque.text);
      if (typeof crudo !== 'object' || crudo === null) return vacia;

      const o = crudo as Record<string, unknown>;
      return {
        nombre: typeof o['nombre'] === 'string' ? o['nombre'] : null,
        cantidad: typeof o['cantidad'] === 'number' ? o['cantidad'] : null,
        unidad: this.leerUnidad(o['unidad']),
        confianza: typeof o['confianza'] === 'number' ? o['confianza'] : 0,
        nota: typeof o['nota'] === 'string' ? o['nota'] : null,
      };
    } catch {
      return vacia;
    }
  }

  private leerUnidad(valor: unknown): PropuestaInterpretacion['unidad'] {
    const validas = ['Unidad', 'Kilogram', 'Liter', 'Portion'] as const;
    return validas.find((u) => u === valor) ?? null;
  }

  private api(): Anthropic {
    if (!this.cliente) {
      const c = config();
      this.cliente = new Anthropic({
        apiKey: c.OPENROUTER_API_KEY ?? '',
        // OpenRouter expone un endpoint compatible con la API de Anthropic.
        // Se apunta ahí solo si está configurado; si no, va directo a
        // Anthropic, donde el cacheo de prompt y `effort` son nativos.
        ...(c.BASE_URL_LLM ? { baseURL: c.BASE_URL_LLM } : {}),
      });
    }
    return this.cliente;
  }
}
