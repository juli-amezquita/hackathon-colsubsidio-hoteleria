import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as contratos from '@cci/contracts';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { ZodEnum, type ZodTypeAny } from 'zod';

/**
 * F-08 · Control de deriva entre los esquemas Zod y el OpenAPI.
 *
 * El Principio VI prohíbe redefinir a mano un tipo que ya existe. Pero el
 * peligro real no es tener dos definiciones: es que se separen **en silencio**.
 * El día que alguien añada un motivo de auditoría al yaml y no a Zod —o al
 * revés— nadie se entera hasta que el frontend, que lo desarrolla otro equipo,
 * mande un valor que la API rechaza.
 *
 * Esta prueba es lo que convierte esa divergencia en un build en rojo.
 */

const RUTA_OPENAPI = join(
  __dirname,
  '..',
  '..',
  '..',
  'specs',
  '001-captura-inventarios',
  'contracts',
  'openapi.yaml',
);

interface EsquemaOpenApi {
  readonly enum?: readonly string[];
  readonly type?: string;
}

function componentes(): Record<string, EsquemaOpenApi> {
  const doc = parse(readFileSync(RUTA_OPENAPI, 'utf8')) as {
    components?: { schemas?: Record<string, EsquemaOpenApi> };
  };
  const s = doc.components?.schemas;
  if (!s) throw new Error('El OpenAPI no declara components.schemas.');
  return s;
}

/**
 * Enumeraciones que existen en ambos lados y DEBEN coincidir valor por valor.
 * Son las que viajan por la red y las que el frontend tiene que conocer.
 */
const ENUMS: readonly [string, ZodTypeAny][] = [
  ['Rol', contratos.RolSchema],
  ['ModoCaptura', contratos.ModoCapturaSchema],
  ['EstadoRegistro', contratos.EstadoRegistroSchema],
];

describe('F-08 · Zod y OpenAPI no se separan', () => {
  it('el OpenAPI se puede leer y declara sus esquemas', () => {
    expect(Object.keys(componentes()).length).toBeGreaterThan(5);
  });

  for (const [nombre, esquema] of ENUMS) {
    it(`la enumeración ${nombre} tiene los mismos valores en Zod y en OpenAPI`, () => {
      const c = componentes()[nombre];
      expect(c, `${nombre} no está en el OpenAPI`).toBeDefined();
      expect(c!.enum, `${nombre} no declara enum en el OpenAPI`).toBeDefined();
      expect(esquema).toBeInstanceOf(ZodEnum);

      const enZod = [...(esquema as ZodEnum<[string, ...string[]]>).options].sort();
      const enYaml = [...c!.enum!].sort();

      expect(enZod).toEqual(enYaml);
    });
  }

  it('los motivos de auditoría coinciden con los de la proyección', () => {
    // Este es el que más fácil se desincroniza: la lista vive en el enum de
    // Postgres, en el OpenAPI y en Zod, y la tocamos cada vez que cambia una
    // regla de consolidación.
    const c = componentes()['ArticuloConsolidado'] as unknown as {
      properties?: { motivoAuditable?: { enum?: string[] } };
    };
    const enYaml = [...(c.properties?.motivoAuditable?.enum ?? [])].sort();
    const enZod = [...contratos.MotivoAuditableSchema.options].sort();

    expect(enYaml.length).toBeGreaterThan(0);
    expect(enZod).toEqual(enYaml);
  });

  it('el origen del valor final coincide', () => {
    const c = componentes()['ArticuloConsolidado'] as unknown as {
      properties?: { origenValor?: { enum?: string[] } };
    };
    expect([...contratos.OrigenValorSchema.options].sort()).toEqual(
      [...(c.properties?.origenValor?.enum ?? [])].sort(),
    );
  });

  it('todo tipo de evento del contrato tiene su esquema de payload', () => {
    // Sin esto, `validarEvento` fallaría en tiempo de ejecución al encontrarse
    // un tipo declarado que nadie definió.
    for (const tipo of contratos.TipoEventoSchema.options) {
      expect(contratos.PAYLOADS[tipo], `Falta el payload de ${tipo}`).toBeDefined();
    }
  });
});
