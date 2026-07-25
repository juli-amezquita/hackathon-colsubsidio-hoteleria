import { randomUUID } from 'node:crypto';

import { NestFactory, Reflector } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { SesionService } from '../src/modules/identidad/sesion.service';
import { SesionGuard } from '../src/platform/autorizacion/sesion.guard';
import { opcionesSsl } from '../src/platform/db/ssl';
import { registrarSeguridad } from '../src/platform/seguridad/registrar';

/**
 * Aprendizaje — el sistema mirándose a sí mismo.
 *
 * Lo que se demuestra aquí no es que el agente se auto-mejore: es que la
 * operación **genera sus propias etiquetas** y que esas etiquetas se convierten
 * en propuestas concretas que una persona aprueba.
 *
 * La distinción importa. Un bucle que se aplicara a sí mismo derivaría hacia no
 * alertar —las alertas parecen fricción— y acabaría apagando el control con
 * todas las métricas en verde. Aquí el sistema ordena y propone; una persona
 * dispone, con nombre y fecha.
 */

const URL_BD = process.env['DATABASE_URL'] ?? 'postgres://cci:cci_local@localhost:5432/cci';

let ip = '';
let contador = 0;
beforeEach(() => {
  contador += 1;
  ip = `10.9.${Math.floor(contador / 250)}.${contador % 250}`;
});

describe('Aprendizaje · el reporte y sus propuestas', () => {
  let app: NestFastifyApplication;
  let sql: postgres.Sql;
  let cookieOperador: string;
  let cookieAuditor: string;
  let cookieAdmin: string;
  let unidadId: string;
  let desde: string;

  const pedir = (cookie: string, opciones: { method: string; url: string; payload?: unknown }) =>
    app.getHttpAdapter().getInstance().inject({
      ...opciones,
      headers: opciones.payload === undefined
        ? { cookie }
        : { cookie, 'content-type': 'application/json' },
      remoteAddress: ip,
    } as never);

  const entrar = async (documento: string): Promise<string> => {
    const r = await app.getHttpAdapter().getInstance().inject({
      method: 'POST',
      url: '/sesion',
      payload: { usuario: documento, password: 'Inventario2026*' },
      remoteAddress: '10.9.0.0',
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

    cookieOperador = await entrar('1000000001');
    cookieAuditor = await entrar('1000000002');
    cookieAdmin = await entrar('1000000003');

    const [u] = await sql<{ id: string }[]>`SELECT id FROM unidad_medida WHERE nombre = 'Unidad'`;
    unidadId = u!.id;

    // La ventana arranca ahora: el reporte solo debe ver lo de esta suite, no
    // lo que dejaron las demás.
    desde = new Date().toISOString();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await sql.end({ timeout: 5 });
  });

  const bodegaCon = async (nombres: readonly string[]) => {
    const id = randomUUID();
    await sql`INSERT INTO bodega (id, codigo, nombre) VALUES (${id}, ${`AP-${id.slice(0, 8)}`}, 'Bodega de aprendizaje')`;
    await sql`
      INSERT INTO usuario_bodega (usuario_id, bodega_id)
      SELECT id, ${id} FROM usuario WHERE documento IN ('1000000001', '1000000002', '1000000003')`;

    const ids: string[] = [];
    for (const nombre of nombres) {
      const articuloId = randomUUID();
      ids.push(articuloId);
      await sql`
        INSERT INTO articulo (id, bodega_id, nombre, nombre_normalizado, unidad_esperada_id)
        VALUES (${articuloId}, ${id}, ${nombre}, ${nombre.toLowerCase()}, ${unidadId})`;
      await sql`
        INSERT INTO saldo_esperado (bodega_id, articulo_id, cantidad, unidad_id)
        VALUES (${id}, ${articuloId}, '10.000', ${unidadId})`;
    }
    return { bodegaId: id, ids };
  };

  const abrirRonda = async (bodega: string): Promise<string> => {
    const r = await pedir(cookieOperador, { method: 'POST', url: '/rondas', payload: { bodegaId: bodega } });
    expect(r.statusCode, r.body.slice(0, 200)).toBe(201);
    return r.json<{ rondaId: string }>().rondaId;
  };

  const contar = (ronda: string, articuloId: string, cantidad: number, extra: Record<string, unknown> = {}) =>
    pedir(cookieOperador, {
      method: 'POST',
      url: `/rondas/${ronda}/registros`,
      payload: {
        articuloId, cantidad, unidadId, estado: 'contado',
        modoCaptura: 'voz', origenParse: 'gramatica', origenNombre: 'exacto',
        capturadoEn: new Date().toISOString(), claveIdempotencia: randomUUID(), ...extra,
      },
    });

  const reporte = (bodegaId: string, cookie = cookieAuditor) =>
    pedir(cookie, { method: 'GET', url: `/aprendizaje/reporte?desde=${desde}&bodegaId=${bodegaId}` });

  // ────────────────────────────────────────────────────────────────────

  describe('quién lo puede leer', () => {
    it('el Operador no: son métricas de su propio trabajo, no una herramienta de conteo', async () => {
      const { bodegaId: b } = await bodegaCon(['ARROZ']);
      expect((await reporte(b, cookieOperador)).statusCode).toBe(403);
    });

    it('el Auditor y el Administrador sí', async () => {
      const { bodegaId: b } = await bodegaCon(['ARROZ']);
      expect((await reporte(b, cookieAuditor)).statusCode).toBe(200);
      expect((await reporte(b, cookieAdmin)).statusCode).toBe(200);
    });
  });

  describe('las señales que la operación deja sin querer', () => {
    it('mide cuánto resolvió la gramática sola', async () => {
      const { bodegaId: b, ids } = await bodegaCon(['UNO', 'DOS', 'TRES', 'CUATRO']);
      const ronda = await abrirRonda(b);

      await contar(ronda, ids[0]!, 10);
      await contar(ronda, ids[1]!, 10);
      await contar(ronda, ids[2]!, 10);
      await contar(ronda, ids[3]!, 10, { origenParse: 'modelo', textoDictado: 'cuatro raro' });

      const r = reporte(b);
      const d = (await r).json<{ captura: { registros: number; tasaDeGramatica: number } }>();

      expect(d.captura.registros).toBe(4);
      // La métrica que dice si el modelo hace falta: cada punto que sube es
      // dinero que no se gasta y una respuesta que no depende de la red.
      expect(d.captura.tasaDeGramatica).toBe(75);
    });

    it('separa el error de captura de la diferencia real (la etiqueta que importa)', async () => {
      const { bodegaId: b, ids } = await bodegaCon(['CON ERROR', 'CON MERMA']);
      const ronda = await abrirRonda(b);
      await contar(ronda, ids[0]!, 1, { confirmaPeseAAlerta: true });
      await contar(ronda, ids[1]!, 2, { confirmaPeseAAlerta: true });

      for (const [articuloId, razon] of [[ids[0]!, 'ERROR_CONTEO'], [ids[1]!, 'MERMA']] as const) {
        await pedir(cookieAuditor, {
          method: 'POST',
          url: `/auditoria/bodegas/${b}/articulos/${articuloId}/reconteo`,
          payload: {
            cantidad: 10, unidadId, codigoRazonId: razon, modoCaptura: 'texto',
            capturadoEn: new Date().toISOString(), claveIdempotencia: randomUUID(),
          },
        });
      }

      const d = (await reporte(b)).json<{
        auditoria: { erroresDeCaptura: number; diferenciasReales: number; tasaDeErrorDeCaptura: number };
      }>();

      // Sin esta separación, pulir la percepción sería aprender de ruido: un
      // artículo que no cuadra porque falta mercancía no dice nada sobre si el
      // micrófono entendió bien.
      expect(d.auditoria.erroresDeCaptura).toBe(1);
      expect(d.auditoria.diferenciasReales).toBe(1);
      expect(d.auditoria.tasaDeErrorDeCaptura).toBe(50);
    });

    it('el reporte NO lleva el saldo esperado de ningún artículo', async () => {
      const { bodegaId: b, ids } = await bodegaCon(['SECRETO']);
      const ronda = await abrirRonda(b);
      await contar(ronda, ids[0]!, 3, { confirmaPeseAAlerta: true });

      const cuerpo = (await reporte(b)).body;
      const escalares: unknown[] = [];
      const recorrer = (v: unknown): void => {
        if (Array.isArray(v)) v.forEach(recorrer);
        else if (v && typeof v === 'object') Object.values(v).forEach(recorrer);
        else escalares.push(v);
      };
      recorrer(JSON.parse(cuerpo));

      // El saldo de estos artículos es 10. Un reporte de calidad de captura no
      // lo necesita, y no pedirlo es lo que garantiza que no se filtre.
      expect(cuerpo).not.toMatch(/saldo/i);
      expect(escalares.filter((v) => typeof v === 'string' && Number(v) === 10)).toHaveLength(0);
    });
  });

  describe('⭐ de la operación a una propuesta aprobable', () => {
    it('tres desambiguaciones manuales producen una propuesta de alias', async () => {
      const { bodegaId: b, ids } = await bodegaCon(['ACEITE DE OLIVA 10ML BOLSA']);

      // Tres operarios distintos eligen el mismo artículo de la lista de
      // candidatos, diciendo lo mismo. Eso ES un alias, dicho por personas.
      for (let i = 0; i < 3; i++) {
        const ronda = await abrirRonda(b);
        await contar(ronda, ids[0]!, 10, {
          origenNombre: 'seleccion_usuario', textoDictado: 'aceite oliva bolsita',
        });
      }

      const d = (await reporte(b)).json<{
        propuestas: { tipo: string; accion: string; evidencia: string; aplicable: { alias: string } | null }[];
      }>();

      const alias = d.propuestas.find((p) => p.tipo === 'alias');
      expect(alias?.accion).toContain('ACEITE DE OLIVA 10ML BOLSA');
      expect(alias?.evidencia).toContain('3 operarios');
      expect(alias?.aplicable?.alias).toBe('aceite oliva bolsita');
    });

    it('el Administrador la aprueba, y el sistema resuelve ese nombre desde entonces', async () => {
      const { bodegaId: b, ids } = await bodegaCon(['PANELA CUADRADA DE 500 GRAMOS']);

      // Antes: el nombre coloquial no resuelve.
      const ronda = await abrirRonda(b);
      const antes = await pedir(cookieOperador, {
        method: 'POST', url: `/rondas/${ronda}/resolucion-articulo`,
        payload: { textoDictado: 'panelita' },
      });
      expect(antes.json<{ estado: string }>().estado).toBe('sin_coincidencia');

      // Se aprueba el alias que el reporte propondría.
      const aplicar = await pedir(cookieAdmin, {
        method: 'POST', url: '/aprendizaje/alias',
        payload: { bodegaId: b, articuloId: ids[0], alias: 'panelita' },
      });
      expect(aplicar.statusCode).toBe(201);
      expect(aplicar.json<{ aplicada: boolean }>().aplicada).toBe(true);

      // Después: el sistema ya lo sabe. Esto es el pulido, y lo aprobó alguien.
      const despues = await pedir(cookieOperador, {
        method: 'POST', url: `/rondas/${ronda}/resolucion-articulo`,
        payload: { textoDictado: 'panelita' },
      });
      const r = despues.json<{ estado: string; articulo: { articuloId: string } | null; origenNombre: string }>();
      expect(r.estado).toBe('resuelto');
      expect(r.articulo?.articuloId).toBe(ids[0]);
      expect(r.origenNombre).toBe('alias');
    });

    it('el alias queda con nombre y fecha', async () => {
      const { bodegaId: b, ids } = await bodegaCon(['AZUCAR MORENA']);
      await pedir(cookieAdmin, {
        method: 'POST', url: '/aprendizaje/alias',
        payload: { bodegaId: b, articuloId: ids[0], alias: 'azucar morenita' },
      });

      const [fila] = await sql<{ nombre: string; creado_en: Date }[]>`
        SELECT u.nombre, al.creado_en FROM articulo_alias al
        JOIN usuario u ON u.id = al.creado_por
        WHERE al.bodega_id = ${b}`;

      expect(fila!.nombre).toBe('Administrador de Prueba');
      expect(fila!.creado_en).toBeInstanceOf(Date);
    });

    it('solo el Administrador aprueba: aprobar un alias decide a qué artículo se imputa un conteo', async () => {
      const { bodegaId: b, ids } = await bodegaCon(['SAL MARINA']);
      const cuerpo = { bodegaId: b, articuloId: ids[0], alias: 'salcita' };

      expect((await pedir(cookieOperador, { method: 'POST', url: '/aprendizaje/alias', payload: cuerpo })).statusCode).toBe(403);
      expect((await pedir(cookieAuditor, { method: 'POST', url: '/aprendizaje/alias', payload: cuerpo })).statusCode).toBe(403);
    });

    it('aprobar dos veces el mismo alias no falla ni duplica', async () => {
      const { bodegaId: b, ids } = await bodegaCon(['CAFE MOLIDO']);
      const cuerpo = { bodegaId: b, articuloId: ids[0], alias: 'cafecito' };

      expect((await pedir(cookieAdmin, { method: 'POST', url: '/aprendizaje/alias', payload: cuerpo })).json<{ aplicada: boolean }>().aplicada).toBe(true);

      const segundo = await pedir(cookieAdmin, { method: 'POST', url: '/aprendizaje/alias', payload: cuerpo });
      expect(segundo.statusCode).toBe(201);
      // Que ya existiera no es un error: es que alguien se adelantó.
      expect(segundo.json<{ aplicada: boolean; nota: string }>().nota).toMatch(/ya existía/);
    });

    it('el reporte deja dicho que NINGUNA propuesta se aplicó sola', async () => {
      const { bodegaId: b } = await bodegaCon(['X']);
      expect((await reporte(b)).json<{ aplicadas: number }>().aplicadas).toBe(0);
    });
  });
});
