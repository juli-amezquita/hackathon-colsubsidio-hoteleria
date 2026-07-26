import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import { Injectable } from '@nestjs/common';

import { config } from '../../config';
import { HZ_SALIDA, MS_LIMITE_SINTESIS, type PuertoDeSintesis } from './puerto';
import { remuestrear } from './remuestreo';

/**
 * Adaptador de Amazon Polly. Es el proveedor por defecto de la voz.
 *
 * Verificado desde la instancia: responde con PCM, dice el texto exacto y no
 * tiene techo diario. **No hay credencial que gestionar** — el rol de IAM de la
 * máquina lleva `polly:SynthesizeSpeech` y el SDK firma con las credenciales
 * que le da IMDS. Una clave menos en SSM es una clave menos que se puede
 * filtrar (Principio V).
 *
 * ⚠️ Fuera de la instancia esto NO funciona: un usuario de IAM sin ese permiso
 * recibe un `AccessDeniedException`. Es lo esperado y no se compensa con una
 * credencial de repuesto.
 */

/** Neuronal y de español latino. `Pedro` es la voz masculina equivalente. */
const VOZ = 'Lupe';

/**
 * El máximo que Polly entrega en PCM. Los 24 kHz que espera el navegador se
 * consiguen remuestreando aquí, no cambiando el contrato con el dispositivo.
 */
const HZ_POLLY = 16000;

@Injectable()
export class SintesisPolly implements PuertoDeSintesis {
  readonly nombre = 'polly';

  /**
   * La región se dice explícitamente: el SDK v3 **no** la deduce del rol de la
   * instancia. Sin `AWS_REGION` en el entorno, cada llamada moriría con
   * «Region is missing», que no se parece en nada a la causa.
   */
  private readonly cliente = new PollyClient({ region: config().AWS_REGION });

  async sintetizar(texto: string): Promise<Buffer | null> {
    const respuesta = await this.cliente.send(
      new SynthesizeSpeechCommand({
        Text: texto,
        VoiceId: VOZ,
        Engine: 'neural',
        // PCM crudo, no MP3: el dispositivo lo mete en la Web Audio API tal
        // cual, sin decodificar y sin la latencia de decodificar.
        OutputFormat: 'pcm',
        SampleRate: String(HZ_POLLY),
      }),
      // Un proveedor colgado no puede dejar al operario esperando una frase:
      // las frases van en fila y la de después tampoco sonaría.
      { abortSignal: AbortSignal.timeout(MS_LIMITE_SINTESIS) },
    );

    if (!respuesta.AudioStream) return null;

    const bytes = await respuesta.AudioStream.transformToByteArray();
    return remuestrear(Buffer.from(bytes), HZ_POLLY, HZ_SALIDA);
  }
}
