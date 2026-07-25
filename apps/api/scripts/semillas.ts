import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { hash } from '@node-rs/argon2';
import postgres from 'postgres';
import * as XLSX from 'xlsx';

import { opcionesSsl } from '../src/platform/db/ssl';

/**
 * Semillas desde el inventario REAL de Colsubsidio (F-05, Restricción 6).
 *
 * Lee `datos/bodegas-y-stock.xlsx`, que es el archivo que entregó el cliente.
 * Nada de lo que se carga aquí está inventado: bodegas, artículos, códigos,
 * unidades y saldos salen del archivo tal cual.
 *
 * Lo único ficticio son los TRES USUARIOS de prueba, que el archivo no trae y
 * sin los cuales no se puede iniciar sesión. Van marcados como tales.
 *
 * Es determinista: mismos UUID en cada ejecución, derivados del contenido.
 */

const URL_BD = process.env['DATABASE_URL'] ?? 'postgres://cci:cci_local@localhost:5432/cci';
const CLAVE = process.env['SEMILLA_PASSWORD'] ?? 'Inventario2026*';
const ARCHIVO = process.env['ARCHIVO_STOCK'] ?? join(__dirname, '..', 'datos', 'bodegas-y-stock.xlsx');

const HOJA_BODEGAS = 'BODEGAS DISPONIBLES';

interface FilaStock {
  readonly codigo: string | null;
  readonly articulo: string;
  readonly unidad: string;
  readonly sd: number;
}

/**
 * UUID determinista a partir de una cadena, al estilo de un UUIDv5: se toma el
 * digest y se le fijan los bits de versión y variante.
 *
 * El determinismo es el punto: `db:reset` tiene que producir exactamente los
 * mismos identificadores cada vez, o "estado inicial conocido" no significa nada.
 */
function uid(semilla: string): string {
  const h = createHash('sha256').update(`cci:${semilla}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x40; // versión 4
  h[8] = (h[8]! & 0x3f) | 0x80; // variante RFC 4122
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/** Misma normalización que usa la búsqueda por similitud: sin tildes, minúsculas. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

function leerStock(libro: XLSX.WorkBook, hoja: string): FilaStock[] {
  const ws = libro.Sheets[hoja];
  if (!ws) return [];

  const filas = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
  const salida: FilaStock[] = [];

  // El archivo viene de Excel: una celda puede traer texto, número o nada.
  // Se estrecha explícitamente en vez de confiar en `String()`, que sobre un
  // objeto devolvería "[object Object]" y lo metería en la base sin chistar.
  const texto = (v: unknown): string => {
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'number') return String(v);
    return '';
  };

  for (const f of filas) {
    const articulo = texto(f['Artículo']);
    const unidad = texto(f['Unidad']);
    const sd = f['SD'];
    if (!articulo || !unidad || typeof sd !== 'number') continue;

    // Excel guarda los códigos como número: 7290 llega como 7290.0.
    const codigo = texto(f['Nr.Artículo']).replace(/\.0$/, '');

    salida.push({ codigo: codigo === '' ? null : codigo, articulo, unidad, sd });
  }

  return salida;
}

async function main(): Promise<void> {
  if (!existsSync(ARCHIVO)) {
    throw new Error(
      `No se encuentra ${ARCHIVO}. Es el inventario que entregó el cliente y sin él no hay semillas.`,
    );
  }

  const libro = XLSX.readFile(ARCHIVO);
  const hojasStock = libro.SheetNames.filter((n) => n !== HOJA_BODEGAS);

  const sql = postgres(URL_BD, { max: 1, ssl: opcionesSsl(), onnotice: () => {} });

  try {
    const clave = await hash(CLAVE, { algorithm: 2 });

    let totalArticulos = 0;
    let negativos = 0;
    const unidadesVistas = new Set<string>();

    await sql.begin(async (t) => {
      // ---- Unidades de medida --------------------------------------------
      // Las cuatro que trae el archivo, ni una más. `es_peso` decide si aplica
      // tolerancia de merma (FR-2.3).
      //
      // ⚠️ `Liter` queda como NO peso porque el SPEC habla de "unidad de medida
      // de peso". Un líquido también se derrama y se evapora, así que puede que
      // el negocio quiera tolerancia ahí. NO se asume: queda por confirmar.
      const ES_PESO: Record<string, boolean> = {
        Kilogram: true,
        Unidad: false,
        Liter: false,
        Portion: false,
      };

      const idUnidad = new Map<string, string>();
      for (const hoja of hojasStock) {
        for (const f of leerStock(libro, hoja)) unidadesVistas.add(f.unidad);
      }
      for (const u of [...unidadesVistas].sort()) {
        const id = uid(`unidad:${u}`);
        idUnidad.set(u, id);
        await t`INSERT INTO unidad_medida (id, codigo, nombre, es_peso)
                VALUES (${id}, ${u}, ${u}, ${ES_PESO[u] ?? false})
                ON CONFLICT (codigo) DO NOTHING`;
      }

      // ---- Bodegas ---------------------------------------------------------
      // Cada hoja de stock ES una bodega. El archivo trae además una lista de 48
      // bodegas en `BODEGAS DISPONIBLES`, pero los nombres NO coinciden con los
      // de las hojas y no hay forma de emparejarlos sin adivinar.
      // Se registran las 8 con datos; el emparejamiento queda pendiente del
      // cliente (Principio IX: no se inventan datos de negocio).
      for (const hoja of hojasStock) {
        await t`INSERT INTO bodega (id, codigo, nombre, sede)
                VALUES (${uid(`bodega:${hoja}`)}, ${hoja.trim()}, ${hoja.trim()}, 'Piscilago')
                ON CONFLICT (codigo) DO NOTHING`;
      }

      // ---- Usuarios de prueba ---------------------------------------------
      // ⚠️ FICTICIOS. El archivo no trae padrón de usuarios (D3).
      const usuarios = [
        ['1000000001', 'Operador de Prueba', 'operador'],
        ['1000000002', 'Auditor de Prueba', 'auditor'],
        ['1000000003', 'Administrador de Prueba', 'administrador'],
      ] as const;

      for (const [doc, nombre, rol] of usuarios) {
        const id = uid(`usuario:${doc}`);
        await t`INSERT INTO usuario (id, documento, nombre, hash_password, rol_id)
                VALUES (${id}, ${doc}, ${nombre}, ${clave}, ${rol})
                ON CONFLICT (documento) DO NOTHING`;
        for (const hoja of hojasStock) {
          await t`INSERT INTO usuario_bodega (usuario_id, bodega_id)
                  VALUES (${id}, ${uid(`bodega:${hoja}`)}) ON CONFLICT DO NOTHING`;
        }
      }

      // ---- Artículos y saldos ---------------------------------------------
      for (const hoja of hojasStock) {
        const bodegaId = uid(`bodega:${hoja}`);

        for (const f of leerStock(libro, hoja)) {
          const articuloId = uid(`articulo:${hoja}:${f.articulo}`);
          const unidadId = idUnidad.get(f.unidad);
          if (!unidadId) continue;

          await t`INSERT INTO articulo
                    (id, bodega_id, nombre, nombre_normalizado, codigo, unidad_esperada_id)
                  VALUES (${articuloId}, ${bodegaId}, ${f.articulo}, ${normalizar(f.articulo)},
                          ${f.codigo}, ${unidadId})
                  ON CONFLICT (bodega_id, nombre) DO NOTHING`;

          // El SD se carga TAL CUAL, incluidos los negativos. No se corrigen ni
          // se descartan: un saldo negativo es una anomalía real del sistema
          // central y el inventario existe justamente para encontrarla.
          await t`INSERT INTO saldo_esperado (bodega_id, articulo_id, cantidad, unidad_id)
                  VALUES (${bodegaId}, ${articuloId}, ${f.sd}, ${unidadId})
                  ON CONFLICT (bodega_id, articulo_id) DO NOTHING`;

          totalArticulos += 1;
          if (f.sd < 0) negativos += 1;
        }
      }

      // ---- Códigos de razón -------------------------------------------------
      // ⚠️ PROVISIONALES. El catálogo controlado lo define el negocio (R4) y no
      // viene en el archivo. Estos permiten probar el flujo del Auditor.
      const razones = [
        ['MERMA', 'Merma natural del producto'],
        ['ERROR_CONTEO', 'Error en el conteo inicial'],
        ['ERROR_CATALOGO', 'Unidad o dato mal parametrizado en el catálogo'],
        ['NO_REGISTRADO', 'Movimiento no registrado en el sistema central'],
        ['DETERIORO', 'Producto deteriorado o vencido'],
        ['TRASLADO', 'Traslado entre bodegas sin registrar'],
        ['SALDO_NEGATIVO', 'El sistema central reportaba saldo negativo'],
        ['FALTANTE', 'Faltante sin causa identificada'],
        ['SOBRANTE', 'Sobrante sin causa identificada'],
      ] as const;

      for (const [id, descripcion] of razones) {
        await t`INSERT INTO codigo_razon (id, descripcion) VALUES (${id}, ${descripcion})
                ON CONFLICT (id) DO NOTHING`;
      }

      // ---- Tolerancia de merma ---------------------------------------------
      // ⚠️ El 0,2% de SPEC.md §4.2 es un EJEMPLO, no un valor confirmado (G-5).
      for (const [codigo, esPeso] of Object.entries(ES_PESO)) {
        if (!esPeso) continue;
        const id = idUnidad.get(codigo);
        if (!id) continue;
        await t`INSERT INTO configuracion_merma (unidad_id, porcentaje)
                VALUES (${id}, 0.002) ON CONFLICT (unidad_id) DO NOTHING`;
      }
    });

    const [b] = await sql<{ n: number }[]>`SELECT count(*)::int n FROM bodega`;
    const [d] = await sql<{ n: number }[]>`SELECT count(DISTINCT nombre)::int n FROM articulo`;

    console.log(`Bodegas con stock:        ${b?.n ?? 0}`);
    console.log(`Filas de artículo:        ${totalArticulos}`);
    console.log(`Artículos distintos:      ${d?.n ?? 0}`);
    console.log(`Unidades:                 ${[...unidadesVistas].sort().join(', ')}`);
    console.log(`Usuarios de prueba:       3 (clave: ${CLAVE})`);
    console.log('');
    console.log(`⚠️  Saldos NEGATIVOS cargados: ${negativos}`);
    console.log('   No se corrigen: son anomalías reales del sistema central y');
    console.log('   el inventario existe para encontrarlas.');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
