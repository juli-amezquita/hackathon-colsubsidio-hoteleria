import { config } from '../../config';
import { SintesisGemini } from './gemini';
import { SintesisPolly } from './polly';
import type { PuertoDeSintesis } from './puerto';

/**
 * Quién pone la voz, según `PROVEEDOR_TTS`.
 *
 * Se resuelve una vez, al abrir la sesión, y no en cada frase: conmutar de
 * proveedor es un cambio de configuración y un reinicio, no una rama en la
 * ruta caliente.
 *
 * `null` es `ninguno` y **no es una degradación**: es la decisión explícita de
 * que el sistema no hable. El diálogo sigue viajando a la pantalla igual, que
 * es lo que sostiene el conteo (FR-1.21). Por eso no avisa de nada — no ha
 * fallado nada.
 */
export function sintetizador(): PuertoDeSintesis | null {
  switch (config().PROVEEDOR_TTS) {
    case 'polly':
      return new SintesisPolly();
    case 'gemini':
      return new SintesisGemini();
    case 'ninguno':
      return null;
  }
}
