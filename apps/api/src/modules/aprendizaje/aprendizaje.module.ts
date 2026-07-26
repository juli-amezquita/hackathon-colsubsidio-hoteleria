import { Module } from '@nestjs/common';

import { SenalesModule } from '../../composicion/senales.module';
import { AprendizajeController } from './aprendizaje.controller';
import { AprendizajeService } from './aprendizaje.service';
import { CriticoService } from './critico.service';

/**
 * Dominio `aprendizaje` — el sistema mirándose a sí mismo.
 *
 * Consume las **interfaces publicadas de señales** de `captura` y `auditoria`,
 * nunca sus tablas ni sus servicios: cada dominio interpreta sus propios datos
 * y entrega números. Este módulo no conoce una sola columna de los otros.
 *
 * El enlace lo hace la raíz de composición (`SenalesModule`), igual que con el
 * catálogo. Cuando escribí el atajo —importar los módulos directamente— la
 * regla de lint lo rechazó, que es exactamente para lo que está.
 */
@Module({
  imports: [SenalesModule],
  controllers: [AprendizajeController],
  providers: [AprendizajeService, CriticoService],
  exports: [CriticoService],
})
export class AprendizajeModule {}
