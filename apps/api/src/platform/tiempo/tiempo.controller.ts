import { Controller, Get } from '@nestjs/common';

import { Publico } from '../autorizacion/decoradores';

/**
 * F-20 · Referencia temporal del servidor (D-16).
 *
 * El choque es real: FR-6.8 exige anclar el momento de cada registro a una
 * referencia confiable, pero un conteo hecho SIN RED no puede llevar sello de
 * servidor en el instante en que ocurre.
 *
 * Un solo campo obligaría a mentir: o se usa el reloj del dispositivo
 * —manipulable, desajustado— o se falsea el momento del conteo como el de su
 * llegada, que en una auditoría es peor.
 *
 * La salida son DOS tiempos. Este endpoint da el primero: el cliente lo pide al
 * abrir la ronda, mide su desfase y a partir de ahí sella `capturadoEn` contra
 * la referencia del servidor en vez de contra su propio reloj. El segundo,
 * `recibidoEn`, lo pone el servidor y es la autoridad.
 */
@Controller('tiempo')
export class TiempoController {
  // Público a propósito: se consulta antes de abrir la ronda y no revela nada.
  @Get()
  @Publico()
  ahora(): { servidor: string; epochMs: number } {
    const ahora = new Date();
    return { servidor: ahora.toISOString(), epochMs: ahora.getTime() };
  }
}
