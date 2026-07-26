import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { SesionDeVoz } from '../src/proveedores/agente-voz/sesion-voz';
import { HZ_SALIDA, SinCupoDeVoz, type PuertoDeSintesis } from '../src/proveedores/sintesis/puerto';
import { remuestrear } from '../src/proveedores/sintesis/remuestreo';

const HZ_POLLY = 16000;

/** PCM 16 bits mono a partir de las muestras, como lo entrega un proveedor. */
function pcm(muestras: readonly number[]): Buffer {
  const b = Buffer.alloc(muestras.length * 2);
  muestras.forEach((m, i) => b.writeInt16LE(m, i * 2));
  return b;
}

function muestras(b: Buffer): number[] {
  return Array.from({ length: b.length >> 1 }, (_, i) => b.readInt16LE(i * 2));
}

describe('Remuestreo 16 kHz → 24 kHz', () => {
  it('estira la señal exactamente en factor 1,5', () => {
    // Un décimo de segundo de audio de Polly son 1600 muestras; a 24 kHz, 2400.
    const salida = remuestrear(pcm(new Array<number>(1600).fill(0)), HZ_POLLY, HZ_SALIDA);

    expect(salida.length >> 1).toBe(2400);
    expect(salida.length).toBe(4800);
  });

  it('una señal constante sigue siendo constante', () => {
    // La prueba que atrapa un remuestreo mal indexado: si el interpolador se
    // sale de sitio, aquí aparecen ceros o chasquidos donde había un tono.
    const salida = remuestrear(pcm(new Array<number>(240).fill(1234)), HZ_POLLY, HZ_SALIDA);

    expect(muestras(salida)).toHaveLength(360);
    expect(new Set(muestras(salida))).toEqual(new Set([1234]));
  });

  it('conserva el signo y la forma de una rampa, sin salirse del rango', () => {
    const entrada = Array.from({ length: 100 }, (_, i) => -1000 + i * 20);
    const salida = muestras(remuestrear(pcm(entrada), HZ_POLLY, HZ_SALIDA));

    expect(salida[0]).toBe(-1000);
    for (let i = 1; i < salida.length; i += 1) {
      expect(salida[i]!).toBeGreaterThanOrEqual(salida[i - 1]!);
    }
    // Interpolar nunca inventa un valor fuera de los que ya había.
    expect(Math.max(...salida)).toBeLessThanOrEqual(Math.max(...entrada));
    expect(Math.min(...salida)).toBeGreaterThanOrEqual(Math.min(...entrada));
  });

  it('interpola entre dos muestras, no repite la anterior', () => {
    // Cada muestra nueva cae a dos tercios de camino de la anterior: sostener
    // el valor en vez de interpolar sonaría a escalón, no a voz.
    const salida = muestras(remuestrear(pcm([0, 300, 600, 900]), HZ_POLLY, HZ_SALIDA));

    expect(salida).toEqual([0, 200, 400, 600, 800, 900]);
  });

  it('devuelve el mismo búfer si no hay nada que remuestrear', () => {
    const entrada = pcm([1, 2, 3]);
    expect(remuestrear(entrada, HZ_SALIDA, HZ_SALIDA)).toBe(entrada);
  });

  it('un búfer vacío o un byte suelto no revientan', () => {
    expect(remuestrear(Buffer.alloc(0), HZ_POLLY, HZ_SALIDA).length).toBe(0);
    // Medio byte no es una muestra: se descarta en vez de leerse a medias.
    expect(remuestrear(Buffer.from([0x11]), HZ_POLLY, HZ_SALIDA).length).toBe(0);
  });
});

/**
 * La degradación por la que el sistema NO deja de contar.
 *
 * Es el único camino por el que el agente enmudece, y probarlo contra el
 * proveedor real es imposible: hay que provocar el fallo. Por eso `decir()`
 * acepta un sintetizador inyectado.
 */
describe('Sin voz, el sistema sigue por texto', () => {
  function montar(sintesis: PuertoDeSintesis | null): {
    sesion: SesionDeVoz;
    audio: Buffer[];
    avisos: string[];
  } {
    const audio: Buffer[] = [];
    const avisos: string[] = [];
    const sesion = new SesionDeVoz({
      claveApi: 'no-se-usa-sin-websocket',
      terminos: [],
      alTranscribir: () => undefined,
      alRecibirAudio: (p) => audio.push(p),
      alAvisar: (m) => avisos.push(m),
      alCerrar: () => undefined,
      sintesis,
    });
    return { sesion, audio, avisos };
  }

  function proveedor(sintetizar: PuertoDeSintesis['sintetizar']): PuertoDeSintesis {
    return { nombre: 'de-prueba', sintetizar };
  }

  it('entrega el audio cuando la síntesis responde', async () => {
    const { sesion, audio, avisos } = montar(proveedor(() => Promise.resolve(pcm([7, 7]))));

    sesion.decir('Aceite, diez unidades.');

    await vi.waitFor(() => expect(audio).toHaveLength(1));
    expect(muestras(audio[0]!)).toEqual([7, 7]);
    expect(avisos).toEqual([]);
  });

  it('distingue el cupo agotado del fallo genérico', async () => {
    const cupo = montar(proveedor(() => Promise.reject(new SinCupoDeVoz('TTS 429'))));
    cupo.sesion.decir('Uno.');
    await vi.waitFor(() => expect(cupo.avisos).toHaveLength(1));
    expect(cupo.avisos[0]).toMatch(/cupo/i);

    // Polly no tiene techo diario: lo suyo nunca es cupo, y decir que lo es
    // mandaría a recargar una cuenta que está bien.
    const roto = montar(proveedor(() => Promise.reject(new Error('AccessDeniedException'))));
    roto.sesion.decir('Uno.');
    await vi.waitFor(() => expect(roto.avisos).toHaveLength(1));
    expect(roto.avisos[0]).toMatch(/La voz falló/);
    expect(roto.avisos[0]).not.toMatch(/cupo/i);
  });

  it('avisa UNA sola vez, aunque falle en cada frase', async () => {
    const { sesion, avisos, audio } = montar(proveedor(() => Promise.reject(new Error('boom'))));

    sesion.decir('Uno.');
    sesion.decir('Dos.');
    sesion.decir('Tres.');

    await vi.waitFor(() => expect(avisos).toHaveLength(1));
    // Y la cola no se atasca: las tres frases se procesaron.
    expect(audio).toEqual([]);
  });

  it('con PROVEEDOR_TTS=ninguno no hay audio y tampoco hay aviso', async () => {
    // No ha fallado nada: es una decisión de configuración. Avisar de una
    // degradación que nadie sufrió sería ruido en la pantalla del operario.
    const { sesion, audio, avisos } = montar(null);

    sesion.decir('Uno.');
    await new Promise((r) => setImmediate(r));

    expect(audio).toEqual([]);
    expect(avisos).toEqual([]);
  });
});

/**
 * El conmutador. Cada valor se carga con los módulos frescos porque `config()`
 * cachea a propósito: en producción se lee una vez, al arrancar.
 */
describe('PROVEEDOR_TTS elige quién habla', () => {
  const original = { ...process.env };

  beforeAll(() => {
    process.env['GEMINI_API_KEY'] = 'clave-de-prueba';
  });

  afterEach(() => {
    process.env = { ...original, GEMINI_API_KEY: 'clave-de-prueba' };
    vi.resetModules();
  });

  async function elegir(tts?: string): Promise<PuertoDeSintesis | null> {
    vi.resetModules();
    if (tts === undefined) delete process.env['PROVEEDOR_TTS'];
    else process.env['PROVEEDOR_TTS'] = tts;
    const { sintetizador } = await import('../src/proveedores/sintesis/fabrica');
    return sintetizador();
  }

  it('por defecto habla Polly: Gemini no aguanta un conteo en capa gratuita', async () => {
    expect((await elegir())?.nombre).toBe('polly');
  });

  it.each([
    ['polly', 'polly'],
    ['gemini', 'gemini'],
  ])('con %s usa el adaptador %s', async (valor, nombre) => {
    expect((await elegir(valor))?.nombre).toBe(nombre);
  });

  it('con ninguno no hay proveedor, y eso no es un error', async () => {
    expect(await elegir('ninguno')).toBeNull();
  });

  it('rechaza un valor que no es de nadie', async () => {
    await expect(elegir('elevenlabs')).rejects.toThrow(/PROVEEDOR_TTS/);
  });

  it('polly NO exige credencial: firma con el rol de la instancia', async () => {
    vi.resetModules();
    process.env['PROVEEDOR_TTS'] = 'polly';
    delete process.env['GEMINI_API_KEY'];

    const { sintetizador } = await import('../src/proveedores/sintesis/fabrica');
    expect(sintetizador()?.nombre).toBe('polly');
  });

  it('gemini SÍ la exige, y no arranca sin ella', async () => {
    vi.resetModules();
    process.env['PROVEEDOR_TTS'] = 'gemini';
    delete process.env['GEMINI_API_KEY'];

    const { sintetizador } = await import('../src/proveedores/sintesis/fabrica');
    expect(() => sintetizador()).toThrow(/GEMINI_API_KEY/);
  });

  it('el marcador de Terraform NO cuenta como credencial', async () => {
    // El fallo que ya tumbó producción una vez: `PENDIENTE-…` es una cadena no
    // vacía, así que una guarda ingenua lo daba por bueno y la voz fallaba en
    // caliente, frase a frase, sin que nadie supiera por qué.
    vi.resetModules();
    process.env['PROVEEDOR_TTS'] = 'gemini';
    process.env['GEMINI_API_KEY'] = 'PENDIENTE-cargar-con-aws-ssm-put-parameter';

    const { sintetizador } = await import('../src/proveedores/sintesis/fabrica');
    expect(() => sintetizador()).toThrow(/ssm put-parameter/);
  });
});

describe('Adaptador de Gemini', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function cargar(respuesta: Response): Promise<{
    proveedor: PuertoDeSintesis;
    error: typeof SinCupoDeVoz;
  }> {
    vi.resetModules();
    process.env['GEMINI_API_KEY'] = 'clave-de-prueba';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta));

    const [{ SintesisGemini }, puerto] = await Promise.all([
      import('../src/proveedores/sintesis/gemini'),
      import('../src/proveedores/sintesis/puerto'),
    ]);
    return { proveedor: new SintesisGemini(), error: puerto.SinCupoDeVoz };
  }

  it('devuelve el PCM que el modelo pronunció', async () => {
    const audio = pcm([5, 6, 7]).toString('base64');
    const { proveedor } = await cargar(
      Response.json({ candidates: [{ content: { parts: [{ inlineData: { data: audio } }] } }] }),
    );

    // Gemini ya entrega a 24 kHz: aquí no se remuestrea nada.
    expect(muestras((await proveedor.sintetizar('Aceite.'))!)).toEqual([5, 6, 7]);
  });

  it('un 429 es cupo agotado, no un fallo cualquiera', async () => {
    const { proveedor, error } = await cargar(new Response('', { status: 429 }));
    await expect(proveedor.sintetizar('Aceite.')).rejects.toBeInstanceOf(error);
  });

  it('cualquier otro estado es un fallo a secas', async () => {
    const { proveedor, error } = await cargar(new Response('', { status: 500 }));
    const fallo = await proveedor.sintetizar('Aceite.').catch((e: unknown) => e);

    expect(fallo).toBeInstanceOf(Error);
    expect(fallo).not.toBeInstanceOf(error);
  });

  it('una respuesta sin audio no es un error: el texto ya llegó a la pantalla', async () => {
    const { proveedor } = await cargar(Response.json({ candidates: [] }));
    expect(await proveedor.sintetizar('Aceite.')).toBeNull();
  });

  it('pone límite de tiempo: un proveedor colgado no deja al operario esperando', async () => {
    const { proveedor } = await cargar(Response.json({ candidates: [] }));
    await proveedor.sintetizar('Aceite.');

    const [, opciones] = vi.mocked(fetch).mock.calls[0]!;
    expect(opciones?.signal).toBeInstanceOf(AbortSignal);
  });
});
