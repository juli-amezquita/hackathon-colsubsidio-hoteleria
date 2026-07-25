import { Module } from '@nestjs/common';

import { TiempoController } from '../tiempo/tiempo.controller';
import { SaludController } from './salud.controller';

/** Sondas de plataforma: salud y referencia temporal (D-16). */
@Module({ controllers: [SaludController, TiempoController] })
export class SaludModule {}
