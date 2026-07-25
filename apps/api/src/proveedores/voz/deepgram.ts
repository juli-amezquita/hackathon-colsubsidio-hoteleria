import { Injectable } from '@nestjs/common';

import { config } from '../../config';
import { OPCIONES_MODELO, type CredencialDeVoz, type ProveedorDeVoz } from './proveedor';

/**
 * F-24 · Token efímero de Deepgram (D-07, opción A).
 *
 * El navegador se conecta directo al proveedor; nuestra clave de cuenta jamás
 * sale del servidor. Lo que viaja al dispositivo es una credencial de vida
 * corta que solo sirve para transcribir.
 *
 * Esto es lo que mantiene el backend **stateless**: no sostiene conexiones de
 * audio, así que cualquier réplica atiende cualquier petición y un despliegue
 * es un reemplazo, sin sticky sessions ni draining.
 */
@Injectable()
export class DeepgramVoz implements ProveedorDeVoz {
  readonly nombre = 'deepgram';

  private static readonly VIDA_SEGUNDOS = 60;

  async emitirCredencial(contexto: {
    usuarioId: string;
    rondaId: string;
  }): Promise<CredencialDeVoz> {
    const clave = config().DEEPGRAM_API_KEY;
    if (!clave) throw new Error('DEEPGRAM_API_KEY no está configurada.');

    const respuesta = await fetch('https://api.deepgram.com/v1/auth/grant', {
      method: 'POST',
      headers: { authorization: `Token ${clave}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        ttl_seconds: DeepgramVoz.VIDA_SEGUNDOS,
        // Etiquetar la credencial con la ronda deja rastro de para qué se pidió.
        comment: `ronda:${contexto.rondaId}`,
      }),
    });

    if (!respuesta.ok) {
      // Sin detalle del cuerpo: puede traer eco de la credencial (Principio V).
      throw new Error(`Deepgram rechazó la emisión de token (HTTP ${respuesta.status}).`);
    }

    const datos = (await respuesta.json()) as { access_token?: string; expires_in?: number };
    if (!datos.access_token) throw new Error('Deepgram no devolvió un token.');

    const vida = datos.expires_in ?? DeepgramVoz.VIDA_SEGUNDOS;

    return {
      token: datos.access_token,
      expiraEn: new Date(Date.now() + vida * 1000).toISOString(),
      proveedor: 'deepgram',
      endpoint: 'wss://api.deepgram.com/v2/listen',
      opciones: { ...OPCIONES_MODELO, model: 'flux-multilingual' },
    };
  }
}
