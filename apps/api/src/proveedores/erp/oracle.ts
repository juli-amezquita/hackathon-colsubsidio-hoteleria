import { Injectable } from '@nestjs/common';

import { config } from '../../config';
import type { EnvioInventario, PuertoInventarioERP, ResultadoEnvio } from './puerto';

/**
 * H7-03 · Adaptador de Oracle Fusion Cloud Inventory Management (SPEC §6).
 *
 * ⚠️ **No está verificado contra un Oracle real.** El acceso a la instancia del
 * cliente es una dependencia externa que el proyecto no controla y que a la
 * fecha no se ha obtenido. Lo que está implementado es la forma del contrato —
 * el recurso REST de conteos cíclicos, la autenticación básica y el mapeo de la
 * respuesta— para que conectar sea configurar credenciales, no escribir código.
 *
 * Lo que NO se hizo, a propósito: inventar los nombres exactos de los campos.
 * Los que van aquí salen de la documentación pública de Fusion, y el día que se
 * conecte contra la instancia real habrá que ajustarlos. Fingir certeza en un
 * mapeo que nadie ha probado sería peor que decirlo.
 */
@Injectable()
export class ErpOracle implements PuertoInventarioERP {
  readonly nombre = 'oracle';

  async enviar(envio: EnvioInventario): Promise<ResultadoEnvio> {
    const c = config();
    const base = c.ERP_BASE_URL;

    if (!base || !c.ERP_USUARIO || !c.ERP_PASSWORD) {
      return {
        estado: 'fallido',
        aceptadas: 0,
        rechazos: envio.lineas.map((l) => ({ articuloId: l.articuloId, motivo: 'ERP sin configurar' })),
        respuestaCruda: { error: 'Faltan ERP_BASE_URL, ERP_USUARIO o ERP_PASSWORD.' },
      };
    }

    try {
      const respuesta = await fetch(`${base}/fscmRestApi/resources/11.13.18.05/cycleCountListItems`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Basic ${Buffer.from(`${c.ERP_USUARIO}:${c.ERP_PASSWORD}`).toString('base64')}`,
          // La referencia viaja como cabecera de idempotencia: si Fusion la
          // reconoce, el reintento no duplica del otro lado tampoco (FR-7.4).
          'x-request-id': envio.referencia,
        },
        body: JSON.stringify({
          SubinventoryCode: envio.bodegaCodigo,
          CycleCountReference: envio.referencia,
          items: envio.lineas.map((l) => ({
            ItemNumber: l.codigo ?? l.nombre,
            CountQuantity: Number(l.cantidad),
            UOMCode: l.unidad,
            CountReasonCode: l.codigoRazon,
          })),
        }),
      });

      const cuerpo: unknown = await respuesta.json().catch(() => null);

      if (!respuesta.ok) {
        return {
          estado: 'fallido',
          aceptadas: 0,
          rechazos: envio.lineas.map((l) => ({ articuloId: l.articuloId, motivo: `HTTP ${respuesta.status}` })),
          respuestaCruda: cuerpo,
        };
      }

      // Fusion responde con las líneas que aceptó. Si acepta menos de las que
      // se enviaron, esto es PARCIAL — nunca 'aceptado' (edge case H7).
      const aceptadas = contarAceptadas(cuerpo) ?? envio.lineas.length;

      return {
        estado: aceptadas === envio.lineas.length ? 'aceptado' : 'parcial',
        aceptadas,
        rechazos: [],
        respuestaCruda: cuerpo,
      };
    } catch (e) {
      // Que el ERP no esté disponible no puede perder el inventario: el envío
      // queda fallido y la constancia lo dice, para reintentar después.
      return {
        estado: 'fallido',
        aceptadas: 0,
        rechazos: envio.lineas.map((l) => ({ articuloId: l.articuloId, motivo: 'ERP no disponible' })),
        respuestaCruda: { error: String((e as Error)?.message ?? e) },
      };
    }
  }
}

function contarAceptadas(cuerpo: unknown): number | null {
  if (typeof cuerpo !== 'object' || cuerpo === null) return null;
  const items = (cuerpo as Record<string, unknown>)['items'];
  return Array.isArray(items) ? items.length : null;
}
