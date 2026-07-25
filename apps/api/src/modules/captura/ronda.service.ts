import { randomUUID } from 'node:crypto';

import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  ArticuloDeTrabajo,
  DecisionCierre,
  EvidenciaEntrada,
  RegistroAceptado,
  ProductoFantasmaEntrada,
  RegistroEntrada,
  Ronda,
} from '@cci/contracts';
import type postgres from 'postgres';

import { conexion } from '../../platform/db/cliente';
import { PROVEEDOR_CATALOGO, type ProveedorDeCatalogo } from '../../platform/dominio/catalogo';
import { EVENT_BUS, type EventBus } from '../../platform/eventos/bus';
import { desfaseReloj, insertarIdempotente } from '../../platform/idempotencia/idempotencia';
import { evaluarDescripcion } from './descripcion';
import { type Resultado, type Veredicto, validar } from './validacion';

/** Los dos veredictos que dejan una alerta abierta. */
const esAlerta = (v: Veredicto | null): boolean =>
  v === 'alerta_unidad' || v === 'alerta_discrepancia';

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

    // ⚠️ Se lee el saldo, pero SOLO para congelarlo en la fila y compararlo
    // aquí dentro. No vuelve al cliente por ningún camino (FR-1.18); la prueba
    // E2 lo verifica recorriendo cada respuesta valor por valor.
    const ctx = await this.catalogo.contextoDeValidacion(ronda.bodega_id, entrada.articuloId);

    return conexion().begin(async (trx) => {
      let veredicto: Resultado | undefined;

      const resultado = await insertarIdempotente(trx, {
        tabla: 'registro_conteo',
        clave: entrada.claveIdempotencia,
        insertar: async (t) => {
          const fila = await this.insertar(t, ronda, entrada, articulo, ctx);
          if (!fila) return undefined;
          veredicto = fila.veredicto;
          return { id: fila.id, secuencia: fila.secuencia, recibido_en: fila.recibido_en };
        },
        recuperar: async (t) => {
          const f = await t<
            { id: string; secuencia: number; recibido_en: Date; resultado_validacion: Veredicto | null }[]
          >`
            SELECT id, secuencia, recibido_en, resultado_validacion FROM registro_conteo
            WHERE clave_idempotencia = ${entrada.claveIdempotencia}`;
          // El reintento debe ver el MISMO veredicto que la primera vez, y el
          // guardado es la única fuente que no puede haber cambiado desde
          // entonces. Recalcularlo aquí lo expondría a una tolerancia que el
          // Administrador pudo haber tocado en el intervalo (FR-8.2).
          const g = f[0];
          if (!g) return undefined;

          veredicto = {
            veredicto: g.resultado_validacion ?? 'no_validable',
            toleranciaAplicada: null,
            esAlerta: esAlerta(g.resultado_validacion),
          };
          return { id: g.id, secuencia: g.secuencia, recibido_en: g.recibido_en };
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

      const v = veredicto ?? { veredicto: 'no_validable' as const, toleranciaAplicada: null, esAlerta: false };

      return {
        registroId: resultado.valor.id,
        secuencia: resultado.valor.secuencia,
        recibidoEn: resultado.valor.recibido_en.toISOString(),
        validacion: {
          resultado: v.veredicto,
          // Solo en la alerta de unidad. Es catálogo, no saldo (FR-2.1).
          unidadCorrecta: v.veredicto === 'alerta_unidad' ? articulo.unidadEsperada : null,
          // La evidencia se debe cuando el operario decidió sostener su conteo
          // frente a una alerta. Si la alerta sigue sin responder, todavía no
          // hay nada que respaldar: hay una pregunta abierta.
          exigeEvidencia: v.esAlerta && entrada.confirmaPeseAAlerta,
        },
      };
    });
  }

  /**
   * H2-05 · Adjunta la evidencia de audio a un conteo advertido (FR-2.4).
   *
   * Es una fila nueva, no un UPDATE: el registro ya se le confirmó al operario
   * y es inmutable. La subida es diferida (D-07) — el audio puede aterrizar
   * minutos después, cuando vuelva la red.
   */
  async adjuntarEvidencia(
    rondaId: string,
    operadorId: string,
    registroId: string,
    entrada: EvidenciaEntrada,
  ) {
    await this.rondaAbiertaDe(rondaId, operadorId);

    return conexion().begin(async (trx) => {
      const [reg] = await trx<{ advertido: boolean }[]>`
        SELECT advertido FROM registro_conteo
        WHERE id = ${registroId} AND ronda_id = ${rondaId}`;

      if (!reg) {
        throw new NotFoundException({ codigo: 'REGISTRO_NO_ENCONTRADO', mensaje: 'Registro no disponible.' });
      }
      // Aceptar evidencia de un conteo sin alerta llenaría el bucket de audio
      // que nadie va a escuchar y diluiría el valor de la marca.
      if (!reg.advertido) {
        throw new BadRequestException({
          codigo: 'REGISTRO_SIN_ADVERTENCIA',
          mensaje: 'Este conteo no fue confirmado pese a una alerta; no requiere evidencia.',
        });
      }

      const evidenciaId = randomUUID();
      await trx`
        INSERT INTO evidencia_audio (id, clave_s3)
        VALUES (${evidenciaId}, ${entrada.claveS3})`;

      // Un solo audio por registro: la PK lo impone y el reintento es inocuo.
      await trx`
        INSERT INTO evidencia_registro (registro_id, evidencia_id)
        VALUES (${registroId}, ${evidenciaId})
        ON CONFLICT (registro_id) DO NOTHING`;

      return { registroId, adjuntada: true };
    });
  }

  private async insertar(
    trx: postgres.TransactionSql,
    ronda: { id: string; bodega_id: string },
    entrada: RegistroEntrada,
    articulo: ArticuloDeTrabajo,
    ctx: { saldoEsperado: string | null; toleranciaMerma: string | null },
  ): Promise<{ id: string; secuencia: number; recibido_en: Date; veredicto: Resultado } | undefined> {
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
    const previo = await trx<{ maxima: number | null; total: number; verificados: number }[]>`
      SELECT max(secuencia) AS maxima,
             count(*)::int AS total,
             -- Cuántas veces se le respondió ya sobre este artículo. Es el
             -- contador que agota el oráculo de la alerta (MAX_VERIFICACIONES).
             count(*) FILTER (
               WHERE resultado_validacion IN ('aceptado', 'alerta_unidad', 'alerta_discrepancia')
             )::int AS verificados
      FROM registro_conteo
      WHERE ronda_id = ${ronda.id} AND articulo_id = ${entrada.articuloId}
        AND clave_idempotencia <> ${entrada.claveIdempotencia}`;

    const yaContado = (previo[0]?.total ?? 0) > 0;

    // FR-1.14: volver a registrar un artículo ya contado exige confirmación
    // explícita, y NO suma. La cantidad declarada es el total del producto.
    //
    // Sostener el conteo frente a una alerta cuenta como esa confirmación: es
    // igual de explícito, y exigir las dos banderas a la vez solo enseñaría al
    // operario a marcarlas ambas sin leerlas.
    if (yaContado && !entrada.confirmaCorreccion && !entrada.confirmaPeseAAlerta) {
      throw new ConflictException({
        codigo: 'ARTICULO_YA_CONTADO',
        mensaje: 'Este artículo ya fue contado en esta ronda. Confirme la corrección para reemplazar el valor.',
      });
    }

    const secuencia = (previo[0]?.maxima ?? 0) + 1;

    // La validación ocurre AQUÍ, en el servidor y dentro de la transacción que
    // guarda el dato (FR-2.5). No en el dispositivo, que podría mentir, ni
    // después, cuando el operario ya se movió de estante.
    const veredicto = validar({
      estado: entrada.estado,
      cantidad: entrada.cantidad === null ? null : entrada.cantidad.toFixed(3),
      unidadId: entrada.unidadId,
      unidadEsperadaId: articulo.unidadEsperada.id,
      esPeso: articulo.unidadEsperada.esPeso,
      saldoEsperado: ctx.saldoEsperado,
      toleranciaMerma: ctx.toleranciaMerma,
      verificacionesPrevias: previo[0]?.verificados ?? 0,
    });

    // La marca de advertencia solo existe si hubo alerta Y el operario la
    // sostuvo. Es la condición que la base también verifica.
    const advertido = veredicto.esAlerta && entrada.confirmaPeseAAlerta;

    const filas = await trx<{ id: string; secuencia: number; recibido_en: Date }[]>`
      INSERT INTO registro_conteo
        (id, ronda_id, articulo_id, secuencia, estado, cantidad, unidad_id,
         saldo_esperado_congelado, tolerancia_aplicada, resultado_validacion,
         modo_captura, origen_parse, origen_nombre,
         capturado_en, clave_idempotencia, advertido)
      VALUES (${randomUUID()}, ${ronda.id}, ${entrada.articuloId}, ${secuencia},
              ${entrada.estado}, ${entrada.cantidad}, ${entrada.unidadId},
              ${ctx.saldoEsperado}, ${veredicto.toleranciaAplicada}, ${veredicto.veredicto},
              ${entrada.modoCaptura}, ${entrada.origenParse}, ${entrada.origenNombre},
              ${entrada.capturadoEn}, ${entrada.claveIdempotencia}, ${advertido})
      ON CONFLICT (clave_idempotencia) DO NOTHING
      RETURNING id, secuencia, recibido_en`;

    return filas[0] && { ...filas[0], veredicto };
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

    // Lo que impide cerrar, dicho antes de intentarlo. Sale de la MISMA vista
    // que aplica el bloqueo, así que la pantalla no puede prometer un cierre
    // que el servidor vaya a rechazar.
    const bloqueos = await conexion()<
      { articulo_id: string; nombre: string; registro_id: string; motivo: string }[]
    >`
      SELECT p.articulo_id, a.nombre, p.registro_id, p.motivo
      FROM pendiente_de_resolver p
      JOIN articulo a ON a.id = p.articulo_id
      WHERE p.ronda_id = ${rondaId}
      ORDER BY a.nombre`;

    return {
      pendientes: filas.map((f) => ({ articuloId: f.id, nombre: f.nombre, codigo: f.codigo })),
      bloqueos: bloqueos.map((b) => ({
        articuloId: b.articulo_id,
        nombre: b.nombre,
        registroId: b.registro_id,
        motivo: b.motivo,
      })),
    };
  }

  /** Cierra la ronda. Ningún artículo puede quedar en estado indefinido (FR-1.11). */
  async cerrar(rondaId: string, operadorId: string, decisiones: readonly DecisionCierre[]) {
    const ronda = await this.rondaAbiertaDe(rondaId, operadorId);

    return conexion().begin(async (trx) => {
      for (const d of decisiones) {
        // `contado_en_cero` es una afirmación sobre el estante —"fui, miré, no
        // había"— y por eso se valida igual que cualquier cantidad (FR-2.7,
        // escenario 9). Un artículo con saldo esperado de 40 que se declara en
        // cero es exactamente la discrepancia que este sistema existe para
        // encontrar. `no_contado` no afirma nada y no se valida.
        const cero = d.estado === 'contado_en_cero';
        const articulo = cero ? await this.catalogo.buscar(ronda.bodega_id, d.articuloId) : null;
        const ctx = articulo
          ? await this.catalogo.contextoDeValidacion(ronda.bodega_id, d.articuloId)
          : { saldoEsperado: null, toleranciaMerma: null };

        const veredicto = articulo
          ? validar({
              estado: 'contado_en_cero',
              cantidad: '0',
              unidadId: articulo.unidadEsperada.id,
              unidadEsperadaId: articulo.unidadEsperada.id,
              esPeso: articulo.unidadEsperada.esPeso,
              ...ctx,
              verificacionesPrevias: 0,
            })
          : { veredicto: 'no_validable' as const, toleranciaAplicada: null, esAlerta: false };

        // Elegir *contado en cero* en el cuadre YA ES la confirmación explícita.
        // La pantalla preguntó, en ese mismo momento, si el estante estaba
        // vacío o si el artículo quedaba fuera del alcance; quien respondió lo
        // primero afirmó sobre la realidad física a sabiendas.
        //
        // Sin esto la ronda quedaría imposible de cerrar: la alerta nacería
        // dentro de la transacción del cierre, el cierre se bloquearía por su
        // causa, la transacción revertiría —y la alerta que lo bloqueó dejaría
        // de existir—. El operario intentaría cerrar para siempre.
        const advertido = veredicto.esAlerta;

        await trx`
          INSERT INTO registro_conteo
            (id, ronda_id, articulo_id, secuencia, estado, cantidad, unidad_id,
             saldo_esperado_congelado, tolerancia_aplicada, resultado_validacion,
             modo_captura, origen_parse, capturado_en, clave_idempotencia, advertido)
          SELECT ${randomUUID()}, ${rondaId}, ${d.articuloId},
                 COALESCE(max(secuencia), 0) + 1, ${d.estado},
                 ${cero ? 0 : null},
                 ${articulo ? articulo.unidadEsperada.id : null},
                 ${ctx.saldoEsperado}, ${veredicto.toleranciaAplicada}, ${veredicto.veredicto},
                 'texto', 'manual', now(), ${d.claveIdempotencia}, ${advertido}
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

      // FR-2.8 · Una alerta sin responder al cerrar es un error que ya nadie va
      // a poder explicar: el operario se fue, el estante cambió, y lo único que
      // quedaría es un número que el sistema sabía dudoso y dejó pasar.
      //
      // La condición sale de la vista `pendiente_de_resolver`, la misma que el
      // cuadre muestra. Reescribirla aquí sería tener dos versiones de la regla
      // que un día dejarían de coincidir.
      const pendientes = await trx<{ motivo: string; n: number }[]>`
        SELECT motivo, count(*)::int n FROM pendiente_de_resolver
        WHERE ronda_id = ${rondaId} GROUP BY motivo`;

      if (pendientes.length > 0) {
        const alertas = pendientes.find((p) => p.motivo === 'alerta_sin_responder')?.n ?? 0;
        const evidencias = pendientes.find((p) => p.motivo === 'evidencia_faltante')?.n ?? 0;

        throw new BadRequestException({
          codigo: alertas > 0 ? 'ALERTAS_SIN_RESOLVER' : 'EVIDENCIA_PENDIENTE',
          mensaje: alertas > 0
            ? `Quedan ${alertas} alertas sin responder. Corrija el conteo o confírmelo.`
            : `Quedan ${evidencias} conteos confirmados pese a una alerta sin su evidencia de audio.`,
          detalles: { alertasSinResponder: alertas, evidenciaFaltante: evidencias },
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

  /**
   * H5-01 a H5-04 · Registra un hallazgo sin correspondencia en el catálogo.
   *
   * Va por su propia ruta y su propia tabla, no por `registro_conteo`, y eso
   * resuelve H5-02 por construcción: **no hay dónde poner una validación de
   * discrepancia** porque no hay saldo contra el cual comparar (FR-5.4). No es
   * un `if` que alguien pueda quitar; es que la columna no existe.
   */
  async registrarFantasma(rondaId: string, operadorId: string, entrada: ProductoFantasmaEntrada) {
    const ronda = await this.rondaAbiertaDe(rondaId, operadorId);

    const veredicto = evaluarDescripcion(entrada.descripcion);
    if (!veredicto.aceptada) {
      throw new BadRequestException({ codigo: 'DESCRIPCION_INSUFICIENTE', mensaje: veredicto.motivo });
    }

    // H5-04 · Antes de crear un fantasma, se pregunta al catálogo.
    //
    // La mayoría de los hallazgos "sin registrar" son un nombre mal dicho o mal
    // transcrito. Crear un fantasma por cada uno llenaría la bandeja del
    // Auditor de casos que se resuelven mirando el catálogo dos segundos, y la
    // bandeja dejaría de ser la lista corta que justifica todo el sistema.
    const candidatos = await this.catalogo.contenidosEn(ronda.bodega_id, entrada.descripcion);

    // Se pregunta, no se impide. Quien tiene el producto en la mano es el
    // operario; el sistema solo se asegura de que haya mirado la lista.
    if (candidatos.length > 0 && !entrada.confirmaNoEsDelCatalogo) {
      throw new ConflictException({
        codigo: 'POSIBLE_ARTICULO_DEL_CATALOGO',
        mensaje: 'El catálogo tiene artículos parecidos. Revíselos antes de reportarlo como no registrado.',
        detalles: { candidatos },
      });
    }

    return conexion().begin(async (trx) => {
      const resultado = await insertarIdempotente(trx, {
        tabla: 'producto_fantasma',
        clave: entrada.claveIdempotencia,
        insertar: async (t) => {
          // Los candidatos van por `t.json`, no por JSON.stringify: postgres.js
          // ya serializa, así que una cadena previa guardaría texto dentro del
          // jsonb y quien lo leyera recibiría una cadena donde espera una lista.
          const f = await t<{ id: string; recibido_en: Date }[]>`
            INSERT INTO producto_fantasma
              (id, ronda_id, bodega_id, descripcion, unidad_observada, cantidad,
               modo_captura, capturado_en, clave_idempotencia, candidatos_catalogo)
            VALUES (${randomUUID()}, ${rondaId}, ${ronda.bodega_id}, ${entrada.descripcion.trim()},
                    ${entrada.unidadObservada}, ${entrada.cantidad},
                    ${entrada.modoCaptura}, ${entrada.capturadoEn}, ${entrada.claveIdempotencia},
                    ${t.json(candidatos)})
            ON CONFLICT (clave_idempotencia) DO NOTHING
            RETURNING id, recibido_en`;
          return f[0];
        },
        recuperar: async (t) => {
          const f = await t<{ id: string; recibido_en: Date }[]>`
            SELECT id, recibido_en FROM producto_fantasma
            WHERE clave_idempotencia = ${entrada.claveIdempotencia}`;
          return f[0];
        },
      });

      if (resultado.creado) {
        await this.bus.publicar(trx, {
          tipo: 'ProductoFantasmaRegistrado',
          actorId: operadorId,
          payload: {
            fantasmaId: resultado.valor.id,
            rondaId,
            bodegaId: ronda.bodega_id,
            descripcion: entrada.descripcion.trim(),
            unidadObservada: entrada.unidadObservada,
            cantidad: entrada.cantidad,
          },
        });
      }

      return {
        fantasmaId: resultado.valor.id,
        recibidoEn: resultado.valor.recibido_en.toISOString(),
        // Fíjate en lo que NO hay aquí: ningún veredicto de validación. No
        // existe saldo esperado contra el cual comparar (FR-5.4).
        candidatosDescartados: candidatos.length,
      };
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
