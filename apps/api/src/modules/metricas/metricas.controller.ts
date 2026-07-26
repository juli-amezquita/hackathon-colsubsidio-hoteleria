import { BadRequestException, Controller, Get, Inject, Query, Req } from '@nestjs/common';

import type { PeticionAutenticada } from '../../platform/autorizacion/sesion.guard';

import { Roles } from '../../platform/autorizacion/decoradores';
import { AutopulidoService } from './autopulido.service';
import { MetricasService } from './metricas.service';

/**
 * La superficie del Dashboard Administrativo.
 *
 * ⚠️ Ninguna ruta lleva `@Roles('operador')`, y es la misma razón de siempre:
 * todo lo que hay aquí son diferencias contra el saldo del sistema, es decir,
 * exactamente lo que FR-1.18 prohíbe que vea quien cuenta. La guarda global
 * niega por defecto, así que el olvido produce un 403 y no una fuga.
 *
 * Se admite al `supervisor` en lectura: su modo consulta ya expone el estado de
 * las bodegas (D-10) y negarle el mismo dato en forma de tabla sería una
 * frontera que no protege nada.
 */
@Controller('metricas')
export class MetricasController {
  constructor(
    @Inject(MetricasService) private readonly metricas: MetricasService,
    @Inject(AutopulidoService) private readonly autopulido: AutopulidoService,
  ) {}

  /** Los filtros: qué meses existen y qué bodegas hay. */
  @Get('periodos')
  @Roles('administrador', 'auditor', 'supervisor')
  periodos(@Req() req: PeticionAutenticada) {
    return this.metricas.periodos(req.usuario!.usuarioId);
  }

  /** BLOQUE 1 · KPI global y por bodega. */
  @Get('resumen')
  @Roles('administrador', 'auditor', 'supervisor')
  resumen(@Req() req: PeticionAutenticada, @Query('periodo') periodo?: string) {
    return this.metricas.resumen(mes(periodo), req.usuario!.usuarioId);
  }

  /** BLOQUE 2 · La tabla granular, paginada. */
  @Get('detalle')
  @Roles('administrador', 'auditor', 'supervisor')
  detalle(
    @Req() req: PeticionAutenticada,
    @Query('periodo') periodo?: string,
    @Query('bodega') bodega?: string,
    @Query('estado') estado?: string,
    @Query('q') q?: string,
    @Query('limite') limite?: string,
    @Query('desde') desde?: string,
  ) {
    return this.metricas.detalle({
      usuarioId: req.usuario!.usuarioId,
      periodo: mes(periodo),
      bodegaId: uuid(bodega),
      estado,
      busqueda: q,
      // Tope duro. Un `limite=999999` en la barra de direcciones no debe poder
      // pedirle a Postgres 60.000 filas y al navegador pintarlas.
      limite: acotar(limite, 50, 1, 500),
      desde: acotar(desde, 0, 0, 1_000_000),
    });
  }

  /** BLOQUE 3 · Serie histórica por bodega. */
  @Get('historia')
  @Roles('administrador', 'auditor', 'supervisor')
  historia(@Req() req: PeticionAutenticada, @Query('meses') meses?: string, @Query('bodega') bodega?: string) {
    return this.metricas.historia(acotar(meses, 12, 1, 36), req.usuario!.usuarioId, uuid(bodega));
  }

  /** BLOQUE 3 · Un producto, mes a mes. */
  @Get('articulo')
  @Roles('administrador', 'auditor', 'supervisor')
  articulo(@Req() req: PeticionAutenticada, @Query('codigo') codigo?: string, @Query('nombre') nombre?: string) {
    return this.metricas.articulo(req.usuario!.usuarioId, {
      codigo: codigo?.trim() || undefined,
      nombre: nombre?.trim() || undefined,
    });
  }

  /** Las causas con las que se cerraron las diferencias. */
  @Get('causas')
  @Roles('administrador', 'auditor', 'supervisor')
  async causas(@Req() req: PeticionAutenticada, @Query('periodo') periodo?: string, @Query('bodega') bodega?: string) {
    return { causas: await this.metricas.porCausa(mes(periodo), req.usuario!.usuarioId, uuid(bodega)) };
  }

  /**
   * El auto-pulido: qué aprendió el sistema sobre sí mismo este mes.
   *
   * No evalúa operarios. Evalúa a la máquina.
   */
  @Get('autopulido')
  @Roles('administrador', 'auditor', 'supervisor')
  pulido(@Query('periodo') periodo?: string) {
    return this.autopulido.informe(mes(periodo));
  }
}

/**
 * El mes, validado.
 *
 * Sin esto, `periodo=2026-07-01'; DROP` no llegaría a inyectar nada —los
 * parámetros van ligados— pero sí produciría un `date` inválido y un 500 con
 * traza de Postgres. Un 400 explícito dice qué se esperaba.
 */
function mes(valor: string | undefined): string {
  if (!valor) {
    const ahora = new Date();
    // Colombia va cinco horas por detrás de UTC: el primer día del mes, entre
    // las 19:00 y la medianoche locales, `getUTCMonth()` ya avanzó de mes.
    const bogota = new Date(ahora.getTime() - 5 * 60 * 60 * 1000);
    return `${bogota.getUTCFullYear()}-${String(bogota.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(valor)) {
    throw new BadRequestException({
      codigo: 'PERIODO_INVALIDO',
      mensaje: 'El periodo se escribe AAAA-MM. Ejemplo: 2026-07.',
    });
  }
  return valor;
}

function uuid(valor: string | undefined): string | undefined {
  if (!valor?.trim()) return undefined;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valor)) {
    throw new BadRequestException({ codigo: 'BODEGA_INVALIDA', mensaje: 'Identificador de bodega no válido.' });
  }
  return valor;
}

function acotar(valor: string | undefined, porDefecto: number, min: number, max: number): number {
  const n = Number(valor);
  if (!Number.isFinite(n)) return porDefecto;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}
