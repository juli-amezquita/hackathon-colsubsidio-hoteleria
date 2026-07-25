import { Injectable } from '@nestjs/common';

import type { EnvioInventario, PuertoInventarioERP, ResultadoEnvio } from './puerto';

/**
 * El ERP simulado. Es el adaptador por defecto y el que corre en la demo.
 *
 * No es un maniquí que devuelve `ok`: guarda las referencias que ya vio y
 * responde igual ante un reenvío, que es exactamente lo que un ERP idempotente
 * debe hacer. Sin eso, la prueba de FR-7.4 estaría verificando el código del
 * llamador contra un doble que le da la razón.
 *
 * ⚠️ La memoria es del proceso: reiniciar la API la borra. La garantía real de
 * no duplicar vive en `constancia_salida.referencia`, que es UNIQUE en la base;
 * esto solo hace honesta la simulación del otro lado.
 */
@Injectable()
export class ErpSimulado implements PuertoInventarioERP {
  readonly nombre = 'simulado';

  private readonly vistas = new Map<string, ResultadoEnvio>();

  enviar(envio: EnvioInventario): Promise<ResultadoEnvio> {
    const previo = this.vistas.get(envio.referencia);
    if (previo) return Promise.resolve(previo);

    const resultado: ResultadoEnvio = {
      estado: 'aceptado',
      aceptadas: envio.lineas.length,
      rechazos: [],
      respuestaCruda: {
        proveedor: this.nombre,
        referencia: envio.referencia,
        bodega: envio.bodegaCodigo,
        lineas: envio.lineas.length,
      },
    };

    this.vistas.set(envio.referencia, resultado);
    return Promise.resolve(resultado);
  }
}
