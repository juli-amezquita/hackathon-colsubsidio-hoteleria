import { randomUUID } from 'node:crypto';

import { NestFactory, Reflector } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { DespachadorService } from '../src/despacho/despacho.module';
import { ConsolidacionService } from '../src/modules/consolidacion/consolidacion.service';
import { SesionService } from '../src/modules/identidad/sesion.service';
import { SesionGuard } from '../src/platform/autorizacion/sesion.guard';
import { opcionesSsl } from '../src/platform/db/ssl';
import { registrarSeguridad } from '../src/platform/seguridad/registrar';

/**
 * Slice 5 — Historia 5: productos fantasma.
 *
 * Es mercancía real que hoy se cae del inventario porque en el papel no hay
 * casilla donde anotarla. Lo que el sistema aporta no es solo la casilla: es
 * que el hallazgo llegue al Auditor con quién lo vio, cómo lo describió y qué
 * artículos del catálogo descartó antes de reportarlo.
 */

const URL_BD = process.env['DATABASE_URL'] ?? 'postgres://cci:cci_local@localhost:5432/cci';

/**
 * Una IP por prueba.
 *
 * El límite de tasa es de 300 peticiones por minuto y por IP — correcto para un
 * operario, que genera unas cuatro—. Una suite entera contra el mismo proceso
 * no es ese escenario: se agotaría el cupo a sí misma y las pruebas fallarían
 * por un 429 que en producción nadie vería. Cada prueba estrena IP, que además
 * es lo que pasa de verdad: son dispositivos distintos.
 */
let ip = '';
let contador = 0;
beforeEach(() => {
  contador += 1;
  ip = `10.5.${Math.floor(contador / 250)}.${contador % 250}`;
});

describe('Slice 5 · productos fantasma', () => {
  let app: NestFastifyApplication;
  let sql: postgres.Sql;
  let cookieOperador: string;
  let cookieAuditor: string;
  let despachador: DespachadorService;
  let consolidacion: ConsolidacionService;
  let unidadId: string;

  const pedir = (cookie: string, opciones: { method: string; url: string; payload?: unknown }) =>
    app.getHttpAdapter().getInstance().inject({
      ...opciones,
      headers: { cookie, 'content-type': 'application/json' },
      remoteAddress: ip,
    } as never);

  const entrar = async (documento: string): Promise<string> => {
    const r = await app.getHttpAdapter().getInstance().inject({
      method: 'POST',
      url: '/sesion',
      payload: { usuario: documento, password: 'Inventario2026*' },
      remoteAddress: '10.5.0.0',
    } as never);
    const bruto = r.headers['set-cookie'];
    return (Array.isArray(bruto) ? bruto[0]! : String(bruto)).split(';')[0]!;
  };

  beforeAll(async () => {
    sql = postgres(URL_BD, { max: 4, ssl: opcionesSsl(), onnotice: () => {} });

    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    await registrarSeguridad(app);
    app.useGlobalGuards(new SesionGuard(app.get(Reflector), app.get(SesionService)));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    despachador = app.get(DespachadorService);
    consolidacion = app.get(ConsolidacionService);

    cookieOperador = await entrar('1000000001');
    cookieAuditor = await entrar('1000000002');

    const [u] = await sql<{ id: string }[]>`SELECT id FROM unidad_medida WHERE nombre = 'Unidad'`;
    unidadId = u!.id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await sql.end({ timeout: 5 });
  });

  /**
   * Espera a que el evento de ESTA bodega quede despachado.
   *
   * No basta con drenar el outbox: varias suites corren en paralelo, cada una
   * con su propio despachador, y `FOR UPDATE SKIP LOCKED` hace que el evento
   * propio se lo pueda llevar el despachador de otra —correcto en producción,
   * indeterminista en una prueba—. Se espera por la condición concreta.
   */
  const drenar = async (bodega: string): Promise<void> => {
    for (let i = 0; i < 40; i++) {
      await despachador.pasada();
      const [p] = await sql<{ n: number }[]>`
        SELECT count(*)::int n FROM outbox
        WHERE despachado_en IS NULL AND payload->>'bodegaId' = ${bodega}`;
      if ((p?.n ?? 0) === 0) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`El evento de la bodega ${bodega} no se despachó a tiempo.`);
  };

  const bodegaAislada = async (
    articulos: readonly string[] = [],
  ): Promise<{ bodegaId: string; ids: string[] }> => {
    const id = randomUUID();
    await sql`INSERT INTO bodega (id, codigo, nombre) VALUES (${id}, ${`H5-${id.slice(0, 8)}`}, 'Bodega de prueba H5')`;
    await sql`
      INSERT INTO usuario_bodega (usuario_id, bodega_id)
      SELECT id, ${id} FROM usuario WHERE documento IN ('1000000001', '1000000002')`;

    const ids: string[] = [];
    for (const nombre of articulos) {
      const articuloId = randomUUID();
      ids.push(articuloId);
      await sql`
        INSERT INTO articulo (id, bodega_id, nombre, nombre_normalizado, unidad_esperada_id)
        VALUES (${articuloId}, ${id}, ${nombre}, ${nombre.toLowerCase()}, ${unidadId})`;
      await sql`
        INSERT INTO saldo_esperado (bodega_id, articulo_id, cantidad, unidad_id)
        VALUES (${id}, ${articuloId}, ${'5.000'}, ${unidadId})`;
    }
    return { bodegaId: id, ids };
  };

  const abrirRonda = async (bodega: string, cookie = cookieOperador): Promise<string> => {
    const r = await pedir(cookie, { method: 'POST', url: '/rondas', payload: { bodegaId: bodega } });
    expect(r.statusCode, r.body.slice(0, 200)).toBe(201);
    return r.json<{ rondaId: string }>().rondaId;
  };

  const reportar = (rondaId: string, extra: Record<string, unknown>, cookie = cookieOperador) =>
    pedir(cookie, {
      method: 'POST',
      url: `/rondas/${rondaId}/fantasmas`,
      payload: {
        descripcion: 'Caja de galletas Festival sabor vainilla x 12 unidades',
        unidadObservada: 'caja',
        cantidad: 3,
        modoCaptura: 'voz',
        capturadoEn: new Date().toISOString(),
        claveIdempotencia: randomUUID(),
        confirmaNoEsDelCatalogo: true,
        ...extra,
      },
    });

  const cerrarRonda = async (rondaId: string, bodega: string, cookie = cookieOperador) => {
    const cuadre = await pedir(cookie, { method: 'GET', url: `/rondas/${rondaId}/cuadre-cierre` });
    const r = await pedir(cookie, {
      method: 'POST',
      url: `/rondas/${rondaId}/cierre`,
      payload: {
        decisiones: cuadre.json<{ pendientes: { articuloId: string }[] }>().pendientes.map((p) => ({
          articuloId: p.articuloId, estado: 'no_contado', claveIdempotencia: randomUUID(),
        })),
      },
    });
    expect(r.statusCode, r.body.slice(0, 200)).toBe(201);
    await drenar(bodega);
  };

  // ────────────────────────────────────────────────────────────────────

  describe('el registro del hallazgo (FR-5.1, FR-5.2)', () => {
    it('se puede registrar algo que el catálogo no conoce', async () => {
      const { bodegaId: b } = await bodegaAislada();
      const ronda = await abrirRonda(b);

      const r = await reportar(ronda, {});
      expect(r.statusCode).toBe(201);
      expect(r.json<{ fantasmaId: string }>().fantasmaId).toBeTruthy();
    });

    it('una descripción genérica se rechaza con lo que le falta', async () => {
      const { bodegaId: b } = await bodegaAislada();
      const ronda = await abrirRonda(b);

      const r = await reportar(ronda, { descripcion: 'caja grande de producto sin marca' });
      expect(r.statusCode).toBe(400);

      const error = r.json<{ codigo: string; mensaje: string }>();
      expect(error.codigo).toBe('DESCRIPCION_INSUFICIENTE');
      // El mensaje dice QUÉ agregar. Un "descripción inválida" a secas dejaría
      // al operario adivinando frente al estante.
      expect(error.mensaje).toMatch(/marca|sabor|color|presentación|tamaño/i);
    });

    it('NO trae veredicto de validación: no hay saldo contra el cual comparar (FR-5.4)', async () => {
      const { bodegaId: b } = await bodegaAislada();
      const ronda = await abrirRonda(b);

      const cuerpo = (await reportar(ronda, {})).json<Record<string, unknown>>();
      expect(cuerpo).not.toHaveProperty('validacion');
      expect(JSON.stringify(cuerpo)).not.toMatch(/alerta|discrepancia|saldo/i);
    });

    it('reenviar el mismo sobre no duplica el hallazgo', async () => {
      const { bodegaId: b } = await bodegaAislada();
      const ronda = await abrirRonda(b);
      const clave = randomUUID();

      const uno = await reportar(ronda, { claveIdempotencia: clave });
      const dos = await reportar(ronda, { claveIdempotencia: clave });

      expect(dos.json<{ fantasmaId: string }>().fantasmaId).toBe(uno.json<{ fantasmaId: string }>().fantasmaId);

      const [hallazgos] = await sql<{ n: number }[]>`
        SELECT count(*)::int n FROM producto_fantasma WHERE ronda_id = ${ronda}`;
      expect(hallazgos!.n).toBe(1);
    });

    it('guarda autor, momento, modo de captura y bodega (FR-5.6)', async () => {
      const { bodegaId: b } = await bodegaAislada();
      const ronda = await abrirRonda(b);
      const r = await reportar(ronda, { modoCaptura: 'texto' });

      const [f] = await sql<{ bodega_id: string; modo_captura: string; recibido_en: Date; ronda_id: string }[]>`
        SELECT bodega_id, modo_captura, recibido_en, ronda_id FROM producto_fantasma
        WHERE id = ${r.json<{ fantasmaId: string }>().fantasmaId}`;

      expect(f).toMatchObject({ bodega_id: b, modo_captura: 'texto', ronda_id: ronda });
      expect(f!.recibido_en).toBeInstanceOf(Date);
    });
  });

  describe('la comprobación contra el catálogo (H5-04)', () => {
    it('si el catálogo tiene algo parecido, el sistema PREGUNTA antes', async () => {
      const { bodegaId: b } = await bodegaAislada(['GALLETAS FESTIVAL VAINILLA']);
      const ronda = await abrirRonda(b);

      const r = await reportar(ronda, { confirmaNoEsDelCatalogo: false });

      expect(r.statusCode).toBe(409);
      const error = r.json<{ codigo: string; detalles: { candidatos: { nombre: string }[] } }>();
      expect(error.codigo).toBe('POSIBLE_ARTICULO_DEL_CATALOGO');
      expect(error.detalles.candidatos[0]!.nombre).toBe('GALLETAS FESTIVAL VAINILLA');
    });

    it('pero no lo impide: manda quien tiene el producto en la mano', async () => {
      const { bodegaId: b } = await bodegaAislada(['GALLETAS FESTIVAL VAINILLA']);
      const ronda = await abrirRonda(b);

      const r = await reportar(ronda, { confirmaNoEsDelCatalogo: true });
      expect(r.statusCode).toBe(201);
      expect(r.json<{ candidatosDescartados: number }>().candidatosDescartados).toBeGreaterThan(0);
    });

    it('lo que descartó queda guardado como evidencia para el Auditor', async () => {
      const { bodegaId: b } = await bodegaAislada(['GALLETAS FESTIVAL VAINILLA']);
      const ronda = await abrirRonda(b);
      const r = await reportar(ronda, { confirmaNoEsDelCatalogo: true });

      const caso = (await pedir(cookieAuditor, {
        method: 'GET',
        url: `/auditoria/bodegas/${b}/fantasmas/${r.json<{ fantasmaId: string }>().fantasmaId}`,
      })).json<{ candidatosDescartados: { nombre: string }[] }>();

      // La diferencia entre "apareció algo llamado X" y "apareció algo llamado
      // X, el sistema ofreció estos artículos y quien lo tenía dijo que no".
      expect(caso.candidatosDescartados.map((c) => c.nombre)).toContain('GALLETAS FESTIVAL VAINILLA');
    });

    it('sin nada parecido en el catálogo, no pregunta nada', async () => {
      const { bodegaId: b } = await bodegaAislada(['TORNILLO HEXAGONAL']);
      const ronda = await abrirRonda(b);

      const r = await reportar(ronda, { confirmaNoEsDelCatalogo: false });
      expect(r.statusCode).toBe(201);
      expect(r.json<{ candidatosDescartados: number }>().candidatosDescartados).toBe(0);
    });
  });

  describe('el escalado al Auditor (FR-5.3, FR-5.5)', () => {
    it('todo hallazgo llega a la bandeja, siempre (SC-5.1)', async () => {
      const { bodegaId: b } = await bodegaAislada();
      const ronda = await abrirRonda(b);
      const r = await reportar(ronda, {});
      await cerrarRonda(ronda, b);

      const { items } = (await pedir(cookieAuditor, {
        method: 'GET', url: `/auditoria/bodegas/${b}/pendientes`,
      })).json<{ items: { fantasmaId: string | null; motivo: string; descripcion: string | null }[] }>();

      const hallazgo = items.find((i) => i.fantasmaId === r.json<{ fantasmaId: string }>().fantasmaId);
      expect(hallazgo?.motivo).toBe('producto_fantasma');
      expect(hallazgo?.descripcion).toMatch(/Festival/);
    });

    it('NUNCA se cierra solo (SC-5.2)', async () => {
      const { bodegaId: b } = await bodegaAislada();
      const ronda = await abrirRonda(b);
      await reportar(ronda, {});
      await cerrarRonda(ronda, b);

      // Ni siquiera reproyectando la bodega varias veces.
      await sql.begin((trx) => consolidacion.reproyectar(trx, b));
      await sql.begin((trx) => consolidacion.reproyectar(trx, b));

      const [abiertas] = await sql<{ n: number }[]>`
        SELECT count(*)::int n FROM discrepancia
        WHERE bodega_id = ${b} AND fantasma_id IS NOT NULL AND estado <> 'cerrada'`;
      expect(abiertas!.n).toBe(1);
    });

    it('dos rondas que describen lo mismo NO se fusionan (FR-5.5)', async () => {
      const { bodegaId: b } = await bodegaAislada();

      const primera = await abrirRonda(b);
      await reportar(primera, { descripcion: 'Caja de galletas Festival sabor vainilla x 12 unidades' });
      await cerrarRonda(primera, b);

      const segunda = await abrirRonda(b);
      await reportar(segunda, { descripcion: 'Paca de galletas Festival vainilla doce paquetes' });
      await cerrarRonda(segunda, b);

      // Dos hallazgos, dos casos. Pueden ser la misma caja o dos cajas, y
      // decidirlo mirando texto es exactamente lo que el sistema no debe hacer.
      const [casos] = await sql<{ n: number }[]>`
        SELECT count(*)::int n FROM discrepancia
        WHERE bodega_id = ${b} AND fantasma_id IS NOT NULL`;
      expect(casos!.n).toBe(2);
    });

    it('el Auditor ve el otro hallazgo al abrir uno, sin que estén unidos', async () => {
      const { bodegaId: b } = await bodegaAislada();

      const primera = await abrirRonda(b);
      const uno = await reportar(primera, { descripcion: 'Caja de galletas Festival sabor vainilla x 12 unidades' });
      await cerrarRonda(primera, b);

      const segunda = await abrirRonda(b);
      await reportar(segunda, { descripcion: 'Paca de galletas Festival vainilla doce paquetes' });
      await cerrarRonda(segunda, b);

      const caso = (await pedir(cookieAuditor, {
        method: 'GET',
        url: `/auditoria/bodegas/${b}/fantasmas/${uno.json<{ fantasmaId: string }>().fantasmaId}`,
      })).json<{ otrosHallazgos: { descripcion: string; operador: string }[] }>();

      expect(caso.otrosHallazgos).toHaveLength(1);
      expect(caso.otrosHallazgos[0]!.descripcion).toMatch(/Paca/);
      expect(caso.otrosHallazgos[0]!.operador).toBe('Operador de Prueba');
    });

    it('un hallazgo pendiente bloquea el cierre del inventario', async () => {
      const { bodegaId: b } = await bodegaAislada();
      const ronda = await abrirRonda(b);
      await reportar(ronda, {});
      await cerrarRonda(ronda, b);

      await expect(consolidacion.verificarCierrePosible(b)).rejects.toMatchObject({
        response: { codigo: 'AUDITABLES_PENDIENTES' },
      });
    });
  });

  describe('la resolución por el Auditor', () => {
    const conHallazgo = async () => {
      const { bodegaId: b } = await bodegaAislada();
      const ronda = await abrirRonda(b);
      const r = await reportar(ronda, {});
      await cerrarRonda(ronda, b);
      return { bodegaId: b, fantasmaId: r.json<{ fantasmaId: string }>().fantasmaId };
    };

    const resolver = (b: string, id: string, razon: string, cookie = cookieAuditor) =>
      pedir(cookie, {
        method: 'POST',
        url: `/auditoria/bodegas/${b}/fantasmas/${id}/resolucion`,
        payload: {
          cantidad: 3, unidadId, codigoRazonId: razon, modoCaptura: 'voz',
          capturadoEn: new Date().toISOString(), claveIdempotencia: randomUUID(),
        },
      });

    it('exige causa del catálogo controlado (R4)', async () => {
      const { bodegaId: b, fantasmaId } = await conHallazgo();
      const r = await resolver(b, fantasmaId, 'PORQUE_SI');
      expect(r.statusCode).toBe(400);
      expect(r.json<{ codigo: string }>().codigo).toBe('RAZON_NO_VALIDA');
    });

    it('con causa, el caso queda cerrado y el inventario puede cerrarse', async () => {
      const { bodegaId: b, fantasmaId } = await conHallazgo();

      expect((await resolver(b, fantasmaId, 'NO_REGISTRADO')).statusCode).toBe(201);

      const [d] = await sql<{ estado: string; codigo_razon_id: string }[]>`
        SELECT estado, codigo_razon_id FROM discrepancia WHERE fantasma_id = ${fantasmaId}`;
      expect(d).toMatchObject({ estado: 'cerrada', codigo_razon_id: 'NO_REGISTRADO' });

      await expect(consolidacion.verificarCierrePosible(b)).resolves.toBeUndefined();
    });

    it('el Operador no puede resolverlo', async () => {
      const { bodegaId: b, fantasmaId } = await conHallazgo();
      const r = await resolver(b, fantasmaId, 'NO_REGISTRADO', cookieOperador);
      expect(r.statusCode).toBe(403);
    });
  });
});
