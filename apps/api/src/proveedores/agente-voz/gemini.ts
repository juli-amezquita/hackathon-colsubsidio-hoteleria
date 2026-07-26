import { Injectable } from '@nestjs/common';

import { config } from '../../config';
import { INSTRUCCIONES, type CredencialDeAgente, type ProveedorDeAgenteDeVoz } from './proveedor';

/**
 * H9-01 · Gemini Live — agente de voz conversacional (D-10, reemplazo de Grok).
 *
 * A diferencia de Grok, **esto está verificado contra la API real**: el modelo
 * acepta la sesión, mantiene conversación bidireccional y devuelve audio PCM a
 * 24 kHz con su transcripción. Lo que sigue son las tres cosas que esa
 * verificación dejó claras, porque ninguna es evidente desde la documentación.
 *
 * 1. **Solo `AUDIO`.** Pedir `responseModalities: ['TEXT']` cierra la conexión
 *    con código 1007. Es audio nativo, no un modelo de texto con voz encima.
 *
 * 2. **`outputAudioTranscription` no es opcional para nosotros.** Es lo que
 *    devuelve el texto de lo que el agente dijo, y en este sistema todo lo que
 *    se dice deja rastro. Un agente de voz sin transcripción sería una
 *    conversación de la que no queda constancia.
 *
 * 3. **El modelo no aparece en el listado.** `gemini-3.1-flash-live-preview`
 *    responde a la consulta directa de metadatos con `bidiGenerateContent`,
 *    pero `GET /models` no lo trae. Si se elige un modelo leyendo el listado,
 *    este se queda fuera.
 */

/** Verificado contra la API el 2026-07-26. Ver la nota sobre el listado. */
const MODELO = 'models/gemini-3.1-flash-live-preview';

/**
 * ⚠️ **El token efímero todavía NO autentica la sesión.**
 *
 * La emisión funciona —`POST /v1alpha/auth_tokens` devuelve 200 con su
 * `name`— pero al conectar con él, por los dos métodos que la documentación
 * indica (`?access_token=` y la cabecera `Authorization: Token`), el servidor
 * cierra con **1008 «Method doesn't allow unregistered callers»**. Probado en
 * `v1alpha` y `v1beta`, con y sin el prefijo `auth_tokens/`.
 *
 * Lo que esto NO cambia: **la clave de cuenta no viaja al navegador.** Nunca.
 * Un supervisor con la credencial en el devtools tendría nuestra cuota de
 * Gemini entera, y en capa de pago, nuestra factura. Antes de eso, el modo
 * consulta por texto —que responde exactamente lo mismo— sigue disponible.
 *
 * Cuando Google honre el token, esto empieza a funcionar sin tocar una línea.
 */
const TOKEN_EFIMERO_VERIFICADO = false;

@Injectable()
export class AgenteGeminiLive implements ProveedorDeAgenteDeVoz {
  readonly nombre = 'gemini-live';

  /**
   * Endpoint y modelo SÍ están verificados —a diferencia de Grok— pero la
   * emisión segura de credencial no. Y sin ella no se puede encender: la
   * alternativa sería mandar la clave de cuenta al cliente.
   */
  readonly verificado = TOKEN_EFIMERO_VERIFICADO;

  async emitirCredencial(contexto: { usuarioId: string; bodegaId: string }): Promise<
    Omit<CredencialDeAgente, 'cupo'>
  > {
    const clave = config().GEMINI_API_KEY;
    if (!clave) throw new Error('GEMINI_API_KEY no está configurada.');

    // La sesión queda ACOTADA dentro del propio token: un solo uso, un minuto
    // para iniciarla y la configuración fijada. Aunque se interceptara, no
    // sirve para otro modelo ni para otra cosa que hablar con este agente.
    const respuesta = await fetch('https://generativelanguage.googleapis.com/v1alpha/auth_tokens', {
      method: 'POST',
      headers: { 'x-goog-api-key': clave, 'content-type': 'application/json' },
      body: JSON.stringify({
        uses: 1,
        expireTime: new Date(Date.now() + 15 * 60_000).toISOString(),
        newSessionExpireTime: new Date(Date.now() + 60_000).toISOString(),
        bidiGenerateContentSetup: {
          model: MODELO,
          generationConfig: { responseModalities: ['AUDIO'] },
          outputAudioTranscription: {},
          systemInstruction: { parts: [{ text: INSTRUCCIONES }] },
        },
      }),
    });

    if (!respuesta.ok) {
      // Sin eco del cuerpo: puede traer la credencial (Principio V).
      throw new Error(`Gemini rechazó la emisión del token (HTTP ${respuesta.status}).`);
    }

    const datos = (await respuesta.json()) as { name?: string };
    if (!datos.name) throw new Error('Gemini no devolvió un token efímero.');

    return {
      // ⚠️ El token efímero, JAMÁS `config().GEMINI_API_KEY`. Hay una prueba
      // que lo verifica, porque el descuido aquí no se ve en ninguna pantalla.
      token: datos.name,
      expiraEn: new Date(Date.now() + 60_000).toISOString(),
      proveedor: 'gemini-live',
      endpoint:
        'wss://generativelanguage.googleapis.com/ws/' +
        'google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent',
      configuracion: {
        modelo: MODELO,
        // El cliente manda `?access_token=<token>` y luego `{"setup":{}}`: la
        // configuración ya viaja dentro del token, no la elige el navegador.
        parametroDeAutenticacion: 'access_token',
        // Lo que devuelve el modelo. El navegador necesita Web Audio API para
        // reproducirlo; no es un formato que un `<audio>` acepte.
        formatoDeAudio: 'audio/pcm;rate=24000',
        bodegaId: contexto.bodegaId,
      },
    };
  }
}
