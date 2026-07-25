import Anthropic from '@anthropic-ai/sdk';
import { Inject, Injectable } from '@nestjs/common';

import { config } from '../../config';
import { ArbitroDeterminista } from './determinista';
import {
  RAZONES_CONOCIDAS,
  type EntradaArbitraje,
  type ProveedorDeArbitraje,
  type ResultadoArbitraje,
  type Sintesis,
} from './proveedor';

/**
 * H4-05 · El árbitro con `claude-opus-5`.
 *
 * Es el único punto del sistema donde un modelo produce texto que una persona
 * va a leer para decidir, así que el prompt está escrito alrededor de lo que
 * tiene PROHIBIDO hacer más que de lo que debe hacer.
 *
 * A diferencia del intérprete de voz, aquí **sí** conviene razonar: el caso
 * llega en seis registros dispersos y lo valioso es notar la relación entre
 * ellos —que dos rondas del mismo día difieren justo en el peso de una caja,
 * por ejemplo—. Por eso `thinking: adaptive` y esfuerzo medio.
 *
 * El bloque estático —instrucciones y catálogo de razones— es idéntico en cada
 * llamada y lleva el punto de corte del caché. El caso concreto va después.
 */
@Injectable()
export class ArbitroAnthropic implements ProveedorDeArbitraje {
  readonly nombre = 'anthropic';

  private cliente: Anthropic | undefined;

  constructor(@Inject(ArbitroDeterminista) private readonly respaldo: ArbitroDeterminista) {}

  private static readonly ESQUEMA = {
    type: 'object',
    properties: {
      relato: { type: 'string', description: 'Qué ocurrió, en orden cronológico, sin adjetivos ni conclusiones.' },
      observaciones: {
        type: 'array', maxItems: 4,
        items: { type: 'string' },
        description: 'Hechos observables que llaman la atención. NO conclusiones.',
      },
      preguntas: {
        type: 'array', minItems: 1, maxItems: 4,
        items: { type: 'string' },
        description: 'Qué debe verificar el Auditor en el estante para resolverlo.',
      },
      razonesPlausibles: {
        type: 'array', maxItems: 4,
        items: { type: 'string', enum: [...RAZONES_CONOCIDAS] },
      },
    },
    required: ['relato', 'observaciones', 'preguntas', 'razonesPlausibles'],
    additionalProperties: false,
  } as const;

  private static readonly INSTRUCCIONES = `Ordenas la evidencia de un caso de inventario para que un Auditor humano lo resuelva.

LO QUE TIENES PROHIBIDO HACER:
- NO decides cuál cifra es la correcta. Ni la sugieres, ni la insinúas, ni dices cuál ronda parece más fiable.
- NO propones una cantidad final. Esa la pone el Auditor después de ir físicamente al estante.
- NO afirmas causas. "Probablemente fue merma" está prohibido; "el artículo se mide por peso" es un hecho y sí puedes decirlo.
- NO calificas el trabajo de nadie. Nada de "el operario contó mal".

LO QUE SÍ HACES:
- Cuentas lo que pasó en orden, con nombres y cifras, en una o dos frases.
- Señalas hechos observables que un humano tardaría en notar leyendo registros sueltos: coincidencias de magnitud, cercanía entre cifras, si el sistema traía saldo negativo, si dos rondas ocurrieron con horas de diferencia.
- Escribes las preguntas que el Auditor debería responder EN EL ESTANTE. Preguntas de verdad, verificables físicamente, no retóricas.
- Sugieres qué códigos de razón del catálogo hace plausibles el caso. Sugerir varios está bien; elegir uno no te corresponde.

Escribes en español de Colombia, en tono de acta: llano, corto, sin adornos. El Auditor está de pie en una bodega con un teléfono en la mano.`;

  async ordenar(entrada: EntradaArbitraje): Promise<ResultadoArbitraje> {
    try {
      const respuesta = await this.api().messages.create({
        model: 'claude-opus-5',
        max_tokens: 2048,

        // Relacionar registros dispersos es deliberación, no reconocimiento:
        // aquí el razonamiento sí paga.
        thinking: { type: 'adaptive' },
        output_config: {
          effort: 'medium',
          format: { type: 'json_schema', schema: ArbitroAnthropic.ESQUEMA },
        },

        system: [
          { type: 'text', text: ArbitroAnthropic.INSTRUCCIONES },
          {
            // Estático entre TODOS los casos de todas las bodegas: el prefijo
            // se cachea una vez y sirve para la jornada entera.
            type: 'text',
            text: `CÓDIGOS DE RAZÓN DEL CATÁLOGO CONTROLADO:\n${RAZONES_CONOCIDAS.join('\n')}`,
            cache_control: { type: 'ephemeral', ttl: '1h' },
          },
        ],

        messages: [{ role: 'user', content: this.caso(entrada) }],
      });

      return { sintesis: this.leer(respuesta), proveedor: this.nombre };
    } catch {
      // Que el árbitro falle no puede dejar al Auditor sin poder trabajar: la
      // síntesis es una ayuda para leer el caso, no un requisito para
      // resolverlo. Se degrada al determinista y se sigue.
      return this.respaldo.ordenar(entrada);
    }
  }

  private caso(e: EntradaArbitraje): string {
    const registros = e.registros
      .map((r) => `- ${r.operador} · ronda ${r.ronda.slice(0, 8)} · ${r.cuando} · ${r.estado} · ${r.cantidad ?? 'sin cantidad'} · validación: ${r.veredicto ?? 'ninguna'}`)
      .join('\n');

    return [
      `ARTÍCULO: ${e.articulo} (unidad: ${e.unidad})`,
      `MOTIVO POR EL QUE ESTÁ EN REVISIÓN: ${e.motivo}`,
      `SALDO DEL SISTEMA CENTRAL: ${e.saldoEsperado ?? 'no disponible'}`,
      `TOLERANCIA APLICADA: ${e.toleranciaAplicada ?? 'ninguna'}`,
      '',
      'LO QUE REGISTRÓ CADA RONDA:',
      registros || '- ninguna ronda afirmó nada sobre este artículo',
    ].join('\n');
  }

  private leer(respuesta: Anthropic.Message): Sintesis {
    const bloque = respuesta.content.find((b) => b.type === 'text');
    const vacia: Sintesis = { relato: '', observaciones: [], preguntas: [], razonesPlausibles: [] };
    if (!bloque || bloque.type !== 'text') return vacia;

    try {
      const o = JSON.parse(bloque.text) as Record<string, unknown>;
      const lista = (v: unknown): string[] =>
        Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

      return {
        relato: typeof o['relato'] === 'string' ? o['relato'] : '',
        observaciones: lista(o['observaciones']),
        preguntas: lista(o['preguntas']),
        // Se filtra contra el catálogo aunque el esquema ya lo restrinja: una
        // razón inventada le costaría al Auditor descubrir por su cuenta que
        // la opción no existe.
        razonesPlausibles: lista(o['razonesPlausibles']).filter(
          (r): r is (typeof RAZONES_CONOCIDAS)[number] => RAZONES_CONOCIDAS.includes(r as never),
        ),
      };
    } catch {
      return vacia;
    }
  }

  private api(): Anthropic {
    if (!this.cliente) {
      const c = config();
      this.cliente = new Anthropic({
        apiKey: c.OPENROUTER_API_KEY ?? '',
        // Mismo criterio que el intérprete: por OpenRouter solo si está
        // configurado; si no, directo a Anthropic, donde el cacheo de prompt
        // y `effort` son nativos.
        ...(c.BASE_URL_LLM ? { baseURL: c.BASE_URL_LLM } : {}),
      });
    }
    return this.cliente;
  }
}
