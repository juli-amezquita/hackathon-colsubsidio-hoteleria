/**
 * `PuertoDeSintesis` — la VOZ del sistema, separada de sus oídos.
 *
 * Escuchar y hablar son dos dependencias distintas y aquí se tratan como tales.
 * Oír sigue siendo Gemini Live (`agente-voz/sesion-voz.ts`); hablar es este
 * puerto, con proveedor conmutable por `PROVEEDOR_TTS` (Restricción 5).
 *
 * ## Qué obliga a que esto sea un puerto y no una llamada más
 *
 * La síntesis con Gemini se quedó sin sitio: el plan gratuito da **diez**
 * llamadas al día por modelo (`GenerateRequestsPerDayPerProjectPerModel`, valor
 * medido: 10). Un conteo real las gasta en los primeros minutos y el operario
 * se queda leyendo la pantalla.
 *
 * La salida NO puede ser un modelo conversacional. Se probó `gpt-audio-mini`
 * por OpenRouter y, aun ordenándole a temperatura 0 que repitiera palabra por
 * palabra, reescribía la frase e improvisaba consejos. Un modelo que genera,
 * genera. Aquí la garantía es al revés: **lo que el operario oye lo escribe
 * `dialogo.ts`, nunca un modelo.** Un sintetizador de verdad —Polly— dice el
 * texto que recibe y nada más, y por eso puede hablarle a un operario sin
 * poder decirle el saldo esperado (FR-1.18) ni la dirección de una
 * discrepancia (FR-2.2) aunque se lo pidan.
 */

/**
 * A cuántos hercios sale el audio de este puerto. **Es un contrato, no una
 * preferencia**: `frontend/lib/agente-voz.ts` fija `HZ_SALIDA = 24000` y
 * reproduce el `Int16Array` crudo que llega por el WebSocket.
 *
 * Un proveedor que entregue a otra frecuencia remuestrea AQUÍ. Cambiar el
 * formato que viaja al navegador tocaría la pieza que más costó estabilizar,
 * y para ahorrar una interpolación de coste despreciable.
 */
export const HZ_SALIDA = 24000;

/**
 * Cuánto se espera una frase antes de darla por perdida.
 *
 * El `fetch` de la síntesis no tenía límite, y un proveedor colgado dejaba al
 * operario esperando una confirmación que no iba a llegar: sin audio, sin
 * aviso y sin poder seguir contando, porque las frases van en fila. Ocho
 * segundos es de sobra para una frase de diálogo; pasado eso, el sistema
 * prefiere seguir por texto a quedarse quieto.
 */
export const MS_LIMITE_SINTESIS = 8_000;

/**
 * El proveedor dice que no queda cupo. Es distinto de «la voz falló».
 *
 * La diferencia importa porque las dos cosas se arreglan de forma opuesta: sin
 * cupo hay que recargar la cuenta del proveedor, y ante un fallo hay que mirar
 * el código o la red. Confundirlas hace que nadie sepa cuál de las dos tiene
 * delante.
 *
 * Solo un adaptador que sepa distinguirlo debe lanzarla. Polly no la lanza
 * nunca: no tiene techo diario, así que un fallo suyo es un fallo de verdad.
 */
export class SinCupoDeVoz extends Error {}

export interface PuertoDeSintesis {
  readonly nombre: string;

  /**
   * Devuelve la frase dicha, en PCM 16 bits mono a `HZ_SALIDA`.
   *
   * `null` = el proveedor respondió sin audio. No es un fallo y no degrada
   * nada: el texto ya viajó a la pantalla.
   *
   * Lanza si la síntesis falló. Quien llama decide qué hacer con eso; este
   * puerto no traga errores, porque una voz que enmudece en silencio parece
   * un sistema roto.
   */
  sintetizar(texto: string): Promise<Buffer | null>;
}

export const PUERTO_SINTESIS = Symbol('PuertoDeSintesis');
