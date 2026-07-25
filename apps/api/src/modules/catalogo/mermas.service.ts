import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { Cache, CLAVES } from '../../platform/cache/cache';
import { conexion } from '../../platform/db/cliente';

/**
 * H8-01 a H8-04 · Administración de tolerancias de merma (Historia 8).
 *
 * Existe para que cambiar una línea de una tabla no dependa del equipo técnico.
 * Es poca funcionalidad y tiene una consecuencia grande: la tolerancia decide
 * cuándo el sistema alerta, así que quien la mueve está moviendo el umbral de
 * todo el control. Por eso cada cambio queda con nombre y fecha (FR-8.3).
 *
 * ⚠️ Lo que este servicio NO puede hacer, y es la mitad del valor de la
 * historia: **cambiar el pasado**. Un conteo ya registrado guarda la tolerancia
 * con la que se evaluó (FR-8.2). Subir la merma del 2% al 5% no convierte en
 * conciliado nada de ayer — porque si lo hiciera, este panel sería la forma más
 * fácil de hacer desaparecer una discrepancia sin recontar nada.
 */

/**
 * Techo de la tolerancia. **PROVISIONAL** — lo confirma el negocio (G-4).
 *
 * La merma natural de un producto se mide en unidades porcentuales, no en
 * decenas. Un 25% no es una tolerancia: es apagar la validación para esa unidad
 * sin que quede dicho en ninguna parte. Rechazarlo obliga a que desactivar el
 * control sea una decisión explícita y no un número grande escrito de más.
 */
const MAXIMO = 0.25;

export interface ToleranciaVigente {
  readonly unidadId: string;
  readonly unidad: string;
  readonly esPeso: boolean;
  readonly porcentaje: string | null;
  /** `false` cuando la unidad no se mide por peso: la merma no le aplica. */
  readonly aplica: boolean;
  readonly vigenteEn: string | null;
}

@Injectable()
export class MermasService {
  constructor(@Inject(Cache) private readonly cache: Cache) {}

  /** H8-01 · Todas las unidades, con su tolerancia y si le aplica. */
  async listar(): Promise<ToleranciaVigente[]> {
    const filas = await conexion()<
      { id: string; nombre: string; es_peso: boolean; porcentaje: string | null; vigente_en: Date | null }[]
    >`
      SELECT u.id, u.nombre, u.es_peso, cm.porcentaje, cm.vigente_en
      FROM unidad_medida u
      LEFT JOIN configuracion_merma cm ON cm.unidad_id = u.id
      ORDER BY u.es_peso DESC, u.nombre`;

    return filas.map((f) => ({
      unidadId: f.id,
      unidad: f.nombre,
      esPeso: f.es_peso,
      porcentaje: f.porcentaje,
      // Se muestra aunque no aplique, en vez de esconderlo: un valor guardado
      // que el sistema ignora confunde más si no se ve (edge case de H8).
      aplica: f.es_peso,
      vigenteEn: f.vigente_en?.toISOString() ?? null,
    }));
  }

  /**
   * H8-03 · Fija la tolerancia de una unidad.
   *
   * El cambio y su constancia van en la MISMA transacción: un cambio sin autor
   * registrado es exactamente lo que FR-8.3 existe para impedir, y separarlos
   * dejaría una ventana donde el primero ocurre y el segundo no.
   */
  async fijar(unidadId: string, porcentaje: number, usuarioId: string) {
    if (!Number.isFinite(porcentaje) || porcentaje < 0) {
      throw new BadRequestException({
        codigo: 'TOLERANCIA_INVALIDA',
        mensaje: 'La tolerancia no puede ser negativa. Cero es válido: significa que cualquier diferencia alerta.',
      });
    }

    if (porcentaje > MAXIMO) {
      throw new BadRequestException({
        codigo: 'TOLERANCIA_DESPROPORCIONADA',
        mensaje: `La tolerancia máxima es ${MAXIMO * 100}%. Un valor mayor apagaría la validación de esa unidad sin dejarlo dicho.`,
        detalles: { maximo: MAXIMO },
      });
    }

    const [unidad] = await conexion()<{ id: string; nombre: string; es_peso: boolean }[]>`
      SELECT id, nombre, es_peso FROM unidad_medida WHERE id = ${unidadId}`;
    if (!unidad) {
      throw new NotFoundException({ codigo: 'UNIDAD_NO_ENCONTRADA', mensaje: 'La unidad de medida no existe.' });
    }

    // La escala de la columna es `numeric(6,4)`: se redondea aquí para que lo
    // que se guarda sea exactamente lo que el historial dice que se guardó.
    const valor = porcentaje.toFixed(4);

    await conexion().begin(async (trx) => {
      await trx`
        INSERT INTO configuracion_merma (unidad_id, porcentaje, vigente_en)
        VALUES (${unidadId}, ${valor}, now())
        ON CONFLICT (unidad_id) DO UPDATE
          SET porcentaje = EXCLUDED.porcentaje, vigente_en = now()`;

      await trx`
        INSERT INTO configuracion_merma_historial (unidad_id, porcentaje, cambiado_por)
        VALUES (${unidadId}, ${valor}, ${usuarioId})`;
    });

    // H8-04 · La caché se invalida YA. El TTL de 15 minutos es la red de
    // seguridad, no el mecanismo: un Administrador que cambia la tolerancia y
    // ve que no pasa nada durante un cuarto de hora concluye que el panel no
    // sirve, y vuelve a pedirle el cambio al equipo técnico.
    await this.cache.invalidar(CLAVES.tolerancias().clave);

    return {
      unidadId,
      unidad: unidad.nombre,
      porcentaje: valor,
      aplica: unidad.es_peso,
      // Se dice explícitamente cuando el valor queda inerte, en vez de
      // aceptarlo en silencio y dejar al Administrador creyendo que hizo algo.
      advertencia: unidad.es_peso
        ? null
        : `La unidad ${unidad.nombre} no se mide por peso, así que esta tolerancia no se aplicará mientras siga así (FR-2.3).`,
    };
  }

  /** H8-02 · Quién cambió qué y cuándo (FR-8.5, SC-8.1). */
  async historial(unidadId?: string) {
    const filas = await conexion()<
      { unidad: string; porcentaje: string; usuario: string; cambiado_en: Date }[]
    >`
      SELECT u.nombre AS unidad, h.porcentaje, us.nombre AS usuario, h.cambiado_en
      FROM configuracion_merma_historial h
      JOIN unidad_medida u ON u.id = h.unidad_id
      JOIN usuario us      ON us.id = h.cambiado_por
      WHERE ${unidadId ? conexion()`h.unidad_id = ${unidadId}` : conexion()`true`}
      ORDER BY h.cambiado_en DESC
      LIMIT 200`;

    return filas.map((f) => ({
      unidad: f.unidad,
      porcentaje: f.porcentaje,
      usuario: f.usuario,
      cambiadoEn: f.cambiado_en.toISOString(),
    }));
  }

  /**
   * Las tolerancias vigentes, cacheadas. Ruta caliente: se consulta en CADA
   * conteo, y son cuatro filas que cambian una vez cada varios meses.
   */
  tolerancias(): Promise<Record<string, string>> {
    return this.cache.obtener(CLAVES.tolerancias(), async () => {
      const filas = await conexion()<{ unidad_id: string; porcentaje: string }[]>`
        SELECT unidad_id, porcentaje FROM configuracion_merma`;
      return Object.fromEntries(filas.map((f) => [f.unidad_id, f.porcentaje]));
    });
  }
}
