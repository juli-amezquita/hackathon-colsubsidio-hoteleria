import { Injectable } from '@nestjs/common';

import { config } from '../../config';
import { INSTRUCCIONES, type CredencialDeAgente, type ProveedorDeAgenteDeVoz } from './proveedor';

/**
 * H9-01 · Grok Voice Agent (D-10).
 *
 * ⚠️ `verificado = false` **a propósito, y el sistema lo respeta**: mientras no
 * se confirmen endpoint y tarifa contra la documentación vigente (H9-03), este
 * proveedor no se puede encender aunque se configure. La advertencia no es un
 * comentario que alguien lea o no — es una condición que el código comprueba.
 *
 * Para encenderlo hay que cambiar esta línea, y cambiarla queda en el
 * repositorio con nombre y fecha. Es exactamente el peso que debe tener afirmar
 * "verifiqué la tarifa por minuto de un servicio que vamos a dejar abierto a
 * supervisores".
 */
@Injectable()
export class AgenteGrok implements ProveedorDeAgenteDeVoz {
  readonly nombre = 'grok';

  /** H9-03 · Pendiente: endpoint y tarifa vienen del brief, no de la documentación. */
  readonly verificado = false;

  async emitirCredencial(contexto: { usuarioId: string; bodegaId: string }): Promise<
    Omit<CredencialDeAgente, 'cupo'>
  > {
    const clave = config().XAI_API_KEY;
    if (!clave) throw new Error('XAI_API_KEY no está configurada.');

    // El backend no sostiene el audio (D-07-A): emite una credencial acotada y
    // el navegador habla directo. Mismo patrón que Deepgram, misma razón —
    // mantener el despliegue stateless.
    const respuesta = await fetch('https://api.x.ai/v1/realtime/sessions', {
      method: 'POST',
      headers: { authorization: `Bearer ${clave}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        instructions: INSTRUCCIONES,
        // Contexto acotado: el agente solo puede preguntar por ESTA bodega.
        metadata: { bodega: contexto.bodegaId, usuario: contexto.usuarioId },
      }),
    });

    if (!respuesta.ok) {
      // Sin eco del cuerpo: puede traer la credencial (Principio V).
      throw new Error(`El agente de voz rechazó la emisión (HTTP ${respuesta.status}).`);
    }

    const datos = (await respuesta.json()) as { client_secret?: { value?: string } };
    const token = datos.client_secret?.value;
    if (!token) throw new Error('El agente de voz no devolvió un token.');

    return {
      token,
      expiraEn: new Date(Date.now() + 300_000).toISOString(),
      proveedor: 'grok',
      endpoint: 'wss://api.x.ai/v1/realtime',
      configuracion: { instrucciones: INSTRUCCIONES, herramientas: ['consultar'] },
    };
  }
}
