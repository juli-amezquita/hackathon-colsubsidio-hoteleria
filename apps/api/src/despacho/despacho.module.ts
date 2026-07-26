import {
  Inject,
  Injectable,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

import { config } from '../config';
import { AprendizajeModule } from '../modules/aprendizaje/aprendizaje.module';
import { CriticoService } from '../modules/aprendizaje/critico.service';
import { ConsolidacionModule } from '../modules/consolidacion/consolidacion.module';
import { ConsolidacionService } from '../modules/consolidacion/consolidacion.service';
import { conexion } from '../platform/db/cliente';
import type { Consumidor } from '../platform/eventos/bus';
import { DespachadorOutbox } from '../platform/eventos/despachador';

/**
 * Raíz de composición del bus de eventos.
 *
 * Vive FUERA de `platform/` y fuera de los dominios, y ese es todo su motivo de
 * existir. El despachador es infraestructura genérica y no puede conocer a los
 * dominios; los dominios no pueden conocerse entre sí (Principio III). Alguien
 * tiene que unirlos, y ese alguien es la raíz de composición — el único lugar
 * donde saber quién consume qué no rompe ninguna frontera.
 *
 * Cada slice que añade un consumidor lo añade AQUÍ, en una lista explícita de
 * un solo archivo. Un registro por descubrimiento automático sería más elegante
 * y haría imposible responder "¿quién procesa este evento?" sin ejecutar la
 * aplicación.
 *
 * ⚠️ Este proceso ES el bus (D-25). Es la primera de las tres razones por las
 * que el backend vive en EC2 y no en Lambda: sin un proceso residente no hay
 * quien vacíe el outbox.
 */
@Injectable()
export class DespachadorService implements OnApplicationBootstrap, OnApplicationShutdown {
  private despachador: DespachadorOutbox | undefined;

  constructor(
    @Inject(ConsolidacionService) private readonly consolidacion: ConsolidacionService,
    @Inject(CriticoService) private readonly critico: CriticoService,
  ) {}

  private get consumidores(): readonly Consumidor[] {
    return [this.consolidacion, this.critico];
  }

  onApplicationBootstrap(): void {
    this.despachador = new DespachadorOutbox(conexion(), this.consumidores);

    // En pruebas el despacho es EXPLÍCITO, nunca por temporizador.
    //
    // Cada suite levanta su propia aplicación contra la misma base, así que un
    // despachador de fondo por suite compite por los eventos de las demás:
    // `SKIP LOCKED` funciona —ese es el punto— pero una prueba que espera ver
    // su evento pendiente lo encuentra ya procesado por otro proceso, y falla
    // por una causa que no tiene nada que ver con lo que estaba probando.
    //
    // El temporizador no cubre nada que `pasada()` no cubra: lo único que
    // añade es cuándo se llama.
    if (config().NODE_ENV !== 'test') this.despachador.iniciar();
  }

  onApplicationShutdown(): void {
    this.despachador?.detener();
  }

  /** Una pasada inmediata. Las pruebas la usan para no esperar al temporizador. */
  pasada(): Promise<number> {
    return this.despachador?.pasada() ?? Promise.resolve(0);
  }
}

@Module({
  imports: [ConsolidacionModule, AprendizajeModule],
  providers: [DespachadorService],
  exports: [DespachadorService],
})
export class DespachoModule {}
