import { randomUUID } from 'node:crypto';

import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { DecisionCierre, RegistroAceptado, RegistroEntrada, Ronda } from '@cci/contracts';
import type postgres from 'postgres';

import { conexion } from '../../platform/db/cliente';
import { PROVEEDOR_CATALOGO, type ProveedorDeCatalogo } from '../../platform/dominio/catalogo';
import { EVENT_BUS, type EventBus } from '../../platform/eventos/bus';
import { desfaseReloj, insertarIdempotente } from '../../platform/idempotencia/idempotencia';

/**
 * H1-01 · El dominio `captura`.
 *
 * Aquí viven las tres reglas que hacen del libro un registro de auditoría y no
 * una tabla más:
 *
 *   · **Nada se actualiza en sitio.** Una corrección AÑADE una fila con mayor
 *     secuencia; ambas quedan (D2, D4).
 *   · **El registro es hijo de la tabla madre.** Congela el saldo del sistema
 *     junto a la cantidad contada, en la misma fila (D8).
 *   · **El evento se escribe en la misma transacción que su causa** (Principio IV).
 */
@Injectable()
export class RondaService {
  constructor(
    @Inject(PROVEEDOR_CATALOGO) private readonly catalogo: ProveedorDeCatalogo,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
  ) {}

  /** Abre una ronda propia. No altera ni sobrescribe ninguna otra (FR-1.5). */
  async abrir(bodegaId: string, operadorId: string, epochCliente?: number): Promise<Ronda> {
    const permitida = await conexion()<{ n: number }[]>`
      SELECT count(*)::int n FROM usuario_bodega
      WHERE usuario_id = ${operadorId} AND bodega_id = ${bodegaId}`;
    if ((permitida[0]?.n ?? 0) === 0) {
      throw new NotFoundException({ codigo: 'BODEGA_NO_HABILITADA', mensaje: 'Bodega no disponible.' });
    }

    const id = randomUUID();
    // El desfase se mide al abrir y se guarda con la ronda. No corrige nada:
    // hace que un dispositivo desajustado quede visible en la traza en vez de
    // descubrirse meses después mirando timestamps imposibles (D-16).
    const desfase = epochCliente === undefined ? 0 : desfaseReloj(epochCliente, Date.now());

    const filas = await conexion()<{ abierta_en: Date; nombre: string }[]>`
      WITH nueva AS (
        INSERT INTO ronda (id, bodega_id, operador_id, desfase_reloj_ms)
        VALUES (${id}, ${bodegaId}, ${operadorId}, ${desfase})
        RETURNING id, abierta_en, operador_id
      )
      SELECT n.abierta_en, u.nombre FROM nueva n JOIN usuario u ON u.id = n.operador_id`;

    return {
      rondaId: id,
      bodegaId,
      operadorNombre: filas[0]!.nombre,
      abiertaEn: filas[0]!.abierta_en.toISOString(),
      cerrada: false,
    };
  }

  /**
   * Registra un conteo.
   *
   * Todo ocurre en UNA transacción: la secuencia, el registro y el evento. Si
   * algo falla, no queda ni el dato ni el evento — que es exactamente lo que
   * el Principio IV exige.
   */
  async registrar(
    rondaId: string,
    operadorId: string,
    entrada: RegistroEntrada,
  ): Promise<RegistroAceptado> {
    const ronda = await this.rondaAbiertaDe(rondaId, operadorId);

    const articulo = await this.catalogo.buscar(ronda.bodega_id, entrada.articuloId);
    if (!articulo) {
      throw new NotFoundException({ codigo: 'ARTICULO_NO_ENCONTRADO', mensaje: 'El artículo no pertenece a la bodega.' });
    }

    // ⚠️ Se lee el saldo, pero SOLO para congelarlo en la fila. No vuelve al
    // cliente por ningún camino (FR-1.18); la prueba E2 lo verifica.
    const ctx = await this.catalogo.contextoDeValidacion(ronda.bodega_id, entrada.articuloId);

    return conexion().begin(async (trx) => {
      const resultado = await insertarIdempotente(trx, {
        tabla: 'registro_conteo',
        clave: entrada.claveIdempotencia,
        insertar: (t) => this.insertar(t, ronda, entrada, ctx),
        recuperar: async (t) => {
          const f = await t<{ id: string; secuencia: number; recibido_en: Date }[]>`
            SELECT id, secuencia, recibido_en FROM registro_conteo
            WHERE clave_idempotencia = ${entrada.claveIdempotencia}`;
          return f[0];
        },
      });

      // Un reintento NO vuelve a emitir el evento: el consumidor ya lo procesó.
      if (resultado.creado) {
        await this.bus.publicar(trx, {
          tipo: 'ConteoRegistrado',
          actorId: operadorId,
          payload: {
            rondaId,
            bodegaId: ronda.bodega_id,
            articuloId: entrada.articuloId,
            secuencia: resultado.valor.secuencia,
            estado: entrada.estado,
            cantidad: entrada.cantidad,
            unidadId: entrada.unidadId,
            modoCaptura: entrada.modoCaptura,
          },
        });
      }

      return {
        registroId: resultado.valor.id,
        secuencia: resultado.valor.secuencia,
        recibidoEn: resultado.valor.recibido_en.toISOString(),
      };
    });
  }

  private async insertar(
    trx: postgres.TransactionSql,
    ronda: { id: string; bodega_id: string },
    entrada: RegistroEntrada,
    ctx: { saldoEsperado: number | null; toleranciaMerma: number | null },
  ): Promise<{ id: string; secuencia: number; recibido_en: Date } | undefined> {
    // La secuencia se calcula DENTRO de la transacción, sobre la fila máxima
    // actual. Es lo que hace que una corrección supersede en vez de sobrescribir
    // (D4) sin necesitar un UPDATE, que además está revocado en el motor.
    //
    // Se excluye la propia clave de idempotencia. Un reenvío del MISMO sobre no
    // es un segundo conteo: es el mismo conteo llegando dos veces. Sin esta
    // exclusión el reintento chocaría contra la regla de corrección de abajo y
    // recibiría un 409 en vez de su respuesta original — y el dispositivo, que
    // reintenta precisamente porque no supo si llegó, lo reintentaría para
    // siempre.
    const previo = await trx<{ maxima: number | null; total: number }[]>`
      SELECT max(secuencia) AS maxima, count(*)::int AS total
      FROM registro_conteo
      WHERE ronda_id = ${ronda.id} AND articulo_id = ${entrada.articuloId}
        AND clave_idempotencia <> ${entrada.claveIdempotencia}`;

    const yaContado = (previo[0]?.total ?? 0) > 0;

    // FR-1.14: volver a registrar un artículo ya contado exige confirmación
    // explícita, y NO suma. La cantidad declarada es el total del producto.
    if (yaContado && !entrada.confirmaCorreccion) {
      throw new ConflictException({
        codigo: 'ARTICULO_YA_CONTADO',
        mensaje: 'Este artículo ya fue contado en esta ronda. Confirme la corrección para reemplazar el valor.',
      });
    }

    const secuencia = (previo[0]?.maxima ?? 0) + 1;

    const filas = await trx<{ id: string; secuencia: number; recibido_en: Date }[]>`
      INSERT INTO registro_conteo
        (id, ronda_id, articulo_id, secuencia, estado, cantidad, unidad_id,
         saldo_esperado_congelado, tolerancia_aplicada,
         modo_captura, origen_parse, origen_nombre,
         capturado_en, clave_idempotencia, advertido)
      VALUES (${randomUUID()}, ${ronda.id}, ${entrada.articuloId}, ${secuencia},
              ${entrada.estado}, ${entrada.cantidad}, ${entrada.unidadId},
              ${ctx.saldoEsperado}, ${ctx.toleranciaMerma},
              ${entrada.modoCaptura}, ${entrada.origenParse}, ${entrada.origenNombre},
              ${entrada.capturadoEn}, ${entrada.claveIdempotencia}, ${entrada.confirmaPeseAAlerta})
      ON CONFLICT (clave_idempotencia) DO NOTHING
      RETURNING id, secuencia, recibido_en`;

    return filas[0];
  }

  /**
   * H1-05 · Cuadre de cierre.
   *
   * Devuelve los artículos del catálogo sobre los que la ronda no afirmó nada.
   * Por cada uno el Operador decide entre *contado en cero* y *no contado*
   * (FR-1.15) — y son distintos para siempre: el primero es una afirmación
   * sobre la realidad física y activa la validación; el segundo declara que el
   * artículo quedó fuera del alcance (FR-1.16).
   */
  async cuadreDeCierre(rondaId: string, operadorId: string) {
    const ronda = await this.rondaAbiertaDe(rondaId, operadorId);

    const filas = await conexion()<{ id: string; nombre: string; codigo: string | null }[]>`
      SELECT a.id, a.nombre, a.codigo
      FROM articulo a
      WHERE a.bodega_id = ${ronda.bodega_id} AND a.activo
        AND NOT EXISTS (
          SELECT 1 FROM registro_conteo r
          WHERE r.ronda_id = ${rondaId} AND r.articulo_id = a.id
        )
      ORDER BY a.nombre`;

    return { pendientes: filas.map((f) => ({ articuloId: f.id, nombre: f.nombre, codigo: f.codigo })) };
  }

  /** Cierra la ronda. Ningún artículo puede quedar en estado indefinido (FR-1.11). */
  async cerrar(rondaId: string, operadorId: string, decisiones: readonly DecisionCierre[]) {
    const ronda = await this.rondaAbiertaDe(rondaId, operadorId);

    return conexion().begin(async (trx) => {
      for (const d of decisiones) {
        await trx`
          INSERT INTO registro_conteo
            (id, ronda_id, articulo_id, secuencia, estado, cantidad, unidad_id,
             modo_captura, origen_parse, capturado_en, clave_idempotencia)
          SELECT ${randomUUID()}, ${rondaId}, ${d.articuloId},
                 COALESCE(max(secuencia), 0) + 1, ${d.estado},
                 ${d.estado === 'contado_en_cero' ? 0 : null},
                 ${d.estado === 'contado_en_cero' ? trx`(SELECT unidad_esperada_id FROM articulo WHERE id = ${d.articuloId})` : null},
                 'texto', 'manual', now(), ${d.claveIdempotencia}
          FROM registro_conteo
          WHERE ronda_id = ${rondaId} AND articulo_id = ${d.articuloId}
          ON CONFLICT (clave_idempotencia) DO NOTHING`;
      }

      // El cierre se bloquea si algo quedó sin resolver. Un artículo en estado
      // indefinido al cerrar es una discrepancia que nadie va a poder explicar
      // después.
      const sinResolver = await trx<{ n: number }[]>`
        SELECT count(*)::int n FROM articulo a
        WHERE a.bodega_id = ${ronda.bodega_id} AND a.activo
          AND NOT EXISTS (SELECT 1 FROM registro_conteo r
                          WHERE r.ronda_id = ${rondaId} AND r.articulo_id = a.id)`;

      if ((sinResolver[0]?.n ?? 0) > 0) {
        throw new BadRequestException({
          codigo: 'CUADRE_INCOMPLETO',
          mensaje: `Quedan ${sinResolver[0]!.n} artículos sin decidir entre contado en cero y no contado.`,
        });
      }

      const resueltos = await trx<{ n: number }[]>`
        SELECT count(DISTINCT articulo_id)::int n FROM registro_conteo WHERE ronda_id = ${rondaId}`;

      // El cierre NO es un UPDATE sobre `ronda`: es una fila aquí. Su
      // existencia ES el estado cerrado.
      await trx`INSERT INTO ronda_cierre (ronda_id, cerrada_por) VALUES (${rondaId}, ${operadorId})`;

      await this.bus.publicar(trx, {
        tipo: 'RondaCerrada',
        actorId: operadorId,
        payload: {
          rondaId,
          bodegaId: ronda.bodega_id,
          operadorId,
          articulosResueltos: resueltos[0]?.n ?? 0,
        },
      });

      return { rondaId, cerrada: true, articulosResueltos: resueltos[0]?.n ?? 0 };
    });
  }

  /** La bodega de una ronda propia. El controlador la necesita para resolver. */
  async bodegaDeRonda(rondaId: string, operadorId: string): Promise<string> {
    const r = await this.rondaAbiertaDe(rondaId, operadorId);
    return r.bodega_id;
  }

  /** Una ronda cerrada es inmutable: no admite más registros (FR-1.17). */
  private async rondaAbiertaDe(rondaId: string, operadorId: string) {
    const filas = await conexion()<{ id: string; bodega_id: string; cerrada: boolean }[]>`
      SELECT r.id, r.bodega_id, (rc.ronda_id IS NOT NULL) AS cerrada
      FROM ronda r
      LEFT JOIN ronda_cierre rc ON rc.ronda_id = r.id
      WHERE r.id = ${rondaId} AND r.operador_id = ${operadorId}`;

    const r = filas[0];
    // Mismo error para "no existe" y "no es tuya": decir cuál sería confirmar
    // la existencia de rondas ajenas.
    if (!r) throw new NotFoundException({ codigo: 'RONDA_NO_ENCONTRADA', mensaje: 'Ronda no disponible.' });
    if (r.cerrada) {
      throw new ConflictException({ codigo: 'RONDA_CERRADA', mensaje: 'La ronda ya fue cerrada y es inmutable.' });
    }

    return r;
  }
}
