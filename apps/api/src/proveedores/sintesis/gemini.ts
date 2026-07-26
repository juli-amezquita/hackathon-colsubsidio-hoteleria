import { Injectable } from '@nestjs/common';

import { config } from '../../config';
import { MS_LIMITE_SINTESIS, SinCupoDeVoz, type PuertoDeSintesis } from './puerto';

/**
 * Adaptador de Gemini TTS. Fue el primero y se queda como alternativa.
 *
 * ⚠️ **En capa gratuita no aguanta un conteo.** La cuota medida es
 * `GenerateRequestsPerDayPerProjectPerModel-FreeTier = 10`: diez frases al día
 * y por modelo. Se agota antes de terminar el primer pasillo y a partir de ahí
 * cada llamada vuelve con 429. Sigue aquí porque en capa de pago el techo
 * desaparece y porque un puerto con un solo adaptador no es un puerto
 * (Restricción 5).
 *
 * Devuelve PCM a 24 kHz, que es justo lo que espera el navegador: no hay nada
 * que remuestrear.
 */

const MODELO = 'gemini-2.5-flash-preview-tts';

/** Verificada contra la API. `Charon` y `Puck` devuelven 429 en capa gratuita. */
const VOZ = 'Kore';

@Injectable()
export class SintesisGemini implements PuertoDeSintesis {
  readonly nombre = 'gemini';

  async sintetizar(texto: string): Promise<Buffer | null> {
    const clave = config().GEMINI_API_KEY;
    if (!clave) throw new Error('GEMINI_API_KEY no está configurada.');

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent`,
      {
        method: 'POST',
        headers: {
          'x-goog-api-key': clave,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: texto }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOZ } } },
          },
        }),
        signal: AbortSignal.timeout(MS_LIMITE_SINTESIS),
      },
    );

    if (!r.ok) {
      // El 429 se distingue del resto: en capa gratuita llega enseguida, y
      // confundirlo con "falló la voz" haría que nadie supiera que lo que hay
      // que hacer es recargar el proveedor, no revisar el código.
      if (r.status === 429) throw new SinCupoDeVoz('TTS 429');
      throw new Error(`TTS ${r.status}`);
    }

    const cuerpo = (await r.json()) as {
      candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[];
    };
    const b64 = cuerpo.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    return typeof b64 === 'string' ? Buffer.from(b64, 'base64') : null;
  }
}
