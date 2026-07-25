import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { OPCIONES_MODELO, type CredencialDeVoz, type ProveedorDeVoz } from './proveedor';

/**
 * Adaptador simulado — ciudadano de primera clase, no un parche de pruebas.
 *
 * Permite construir y demostrar el sistema completo **sin credenciales, sin
 * costo y sin red externa**. Es lo que hace que un desarrollador nuevo pueda
 * clonar el repositorio y tener el flujo funcionando en minutos, y lo que
 * mantiene la suite de pruebas determinista.
 */
@Injectable()
export class VozSimulada implements ProveedorDeVoz {
  readonly nombre = 'simulado';

  emitirCredencial(): Promise<CredencialDeVoz> {
    return Promise.resolve({
      token: `simulado-${randomUUID()}`,
      expiraEn: new Date(Date.now() + 60_000).toISOString(),
      proveedor: 'simulado',
      // El cliente reconoce este esquema y usa su guion fijo en vez de red.
      endpoint: 'simulado://transcripcion',
      opciones: { ...OPCIONES_MODELO, model: 'guion-fijo' },
    });
  }
}
