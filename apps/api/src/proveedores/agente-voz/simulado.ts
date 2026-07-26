import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { INSTRUCCIONES, type CredencialDeAgente, type ProveedorDeAgenteDeVoz } from './proveedor';

/**
 * El agente simulado — y el que corre por defecto.
 *
 * No es un parche de pruebas: mientras la tarifa de D-10 no esté verificada
 * (H9-03), este es el proveedor de producción. El dispositivo reconoce el
 * esquema `simulado://` y usa la consulta por texto, que responde exactamente
 * lo mismo porque ambas pasan por el mismo catálogo cerrado de preguntas.
 *
 * Es lo que permite demostrar el modo consulta completo sin gastar un peso ni
 * comprometer un presupuesto que nadie confirmó.
 */
@Injectable()
export class AgenteSimulado implements ProveedorDeAgenteDeVoz {
  readonly nombre = 'simulado';
  readonly verificado = true;

  emitirCredencial(): Promise<Omit<CredencialDeAgente, 'cupo'>> {
    return Promise.resolve({
      token: `agente-simulado-${randomUUID()}`,
      expiraEn: new Date(Date.now() + 300_000).toISOString(),
      proveedor: 'simulado',
      endpoint: 'simulado://agente',
      configuracion: { instrucciones: INSTRUCCIONES, herramientas: ['consultar'] },
    });
  }
}
