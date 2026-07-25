import * as XLSX from 'xlsx';

import type { FilaConsolidada } from './integracion.service';

/**
 * H7-01 · Exportación EN SERVIDOR (Principio I).
 *
 * Armar el archivo en el dispositivo sería más cómodo y crearía un segundo
 * lugar donde vive la regla de qué es el valor final. El día que las dos
 * versiones divergieran —y divergen— nadie sabría cuál se envió al ERP.
 *
 * Las columnas están en español y con nombres que una persona de bodega
 * reconoce, no con los de la base: este archivo lo abre alguien en Excel para
 * responder por él, no un programa.
 */

const COLUMNAS = [
  'Código',
  'Artículo',
  'Unidad',
  'Estado',
  'Motivo',
  'Saldo del sistema',
  'Valor final',
  'Origen del valor',
  'Causa',
  'Rondas que contaron',
] as const;

/** Etiquetas legibles. `sin_cobertura` no significa nada fuera del código. */
const ESTADO: Record<string, string> = {
  conciliado: 'Conciliado',
  auditable: 'Revisado por Auditor',
};

const MOTIVO: Record<string, string> = {
  discrepancia: 'Diferencia contra el sistema',
  contradiccion_entre_rondas: 'Las rondas no coincidieron',
  sin_cobertura: 'Ninguna ronda lo contó',
  sin_saldo_esperado: 'El sistema no tenía saldo',
  producto_fantasma: 'Producto sin registrar',
  resolucion_discrepante: 'Duda sobre qué artículo se contó',
};

const ORIGEN: Record<string, string> = {
  conteo_ciego: 'Conteo ciego (coincidió con el sistema)',
  auditor: 'Reconteo del Auditor',
};

function aMatriz(filas: readonly FilaConsolidada[]): (string | number)[][] {
  return [
    [...COLUMNAS],
    ...filas.map((f) => [
      f.codigo ?? '',
      f.nombre,
      f.unidad,
      ESTADO[f.clasificacion] ?? f.clasificacion,
      f.motivo ? (MOTIVO[f.motivo] ?? f.motivo) : '',
      f.saldoSistema ?? '',
      f.valorFinal ?? '',
      // SC-7.4 · El 100% de los artículos indica el origen de su valor final.
      // Cuando no hay valor final tampoco hay origen, y decirlo es la respuesta
      // correcta: significa que nadie afirmó nada sobre ese estante.
      f.origenValor ? (ORIGEN[f.origenValor] ?? f.origenValor) : 'Sin valor final',
      f.codigoRazon ?? '',
      f.rondasAfirmando,
    ]),
  ];
}

/**
 * CSV con BOM y separador `;`.
 *
 * Los dos detalles importan y por la misma razón: este archivo se abre en el
 * Excel en español de un computador de bodega. Sin BOM las tildes salen rotas;
 * con coma como separador, Excel en configuración regional española mete todo
 * en una sola columna y la persona concluye que el sistema exporta mal.
 */
export function aCsv(filas: readonly FilaConsolidada[]): Buffer {
  const escapar = (v: string | number): string => {
    const s = String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const texto = aMatriz(filas).map((f) => f.map(escapar).join(';')).join('\r\n');
  // U+FEFF al inicio: sin él, Excel abre el archivo en la codificación del
  // sistema y las tildes salen rotas.
  return Buffer.from(`\uFEFF${texto}`, 'utf8');
}

export function aXlsx(filas: readonly FilaConsolidada[], bodega: string): Buffer {
  const hoja = XLSX.utils.aoa_to_sheet(aMatriz(filas));

  // Anchos pensados para que el nombre del artículo se lea sin ajustar nada.
  hoja['!cols'] = [
    { wch: 10 }, { wch: 42 }, { wch: 10 }, { wch: 22 }, { wch: 30 },
    { wch: 16 }, { wch: 12 }, { wch: 36 }, { wch: 16 }, { wch: 18 },
  ];
  hoja['!freeze'] = { xSplit: 0, ySplit: 1 };

  const libro = XLSX.utils.book_new();
  // El nombre de hoja de Excel no admite más de 31 caracteres ni : \ / ? * [ ]
  XLSX.utils.book_append_sheet(libro, hoja, bodega.replace(/[:\\/?*[\]]/g, '').slice(0, 31) || 'Inventario');

  return XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
