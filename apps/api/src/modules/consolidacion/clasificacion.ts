import { ESCALA_CANTIDAD, aEntero } from '../../platform/numeros/decimal';

/**
 * H3-02, H3-03, H3-07 · La regla que convierte conteos en una conclusión.
 *
 * Función pura sobre los registros VIGENTES de cada ronda cerrada. No consulta
 * nada y no escribe nada: entra lo que afirmó cada ronda, sale la clasificación.
 *
 * Es el motor de D5, y por eso la superficie de esta función es tan estrecha.
 * Lo que decide aquí termina publicándose al ERP como inventario real, así que
 * cada camino que lleva a `conciliado` tiene que poder leerse de un vistazo.
 */

export type Clasificacion = 'conciliado' | 'auditable';

export type MotivoAuditable =
  | 'discrepancia'
  | 'contradiccion_entre_rondas'
  | 'sin_cobertura'
  | 'sin_saldo_esperado'
  | 'producto_fantasma';

/** El vigente de UNA ronda cerrada sobre UN artículo (FR-3.6). */
export interface AfirmacionDeRonda {
  readonly rondaId: string;
  readonly estado: 'contado' | 'contado_en_cero' | 'no_contado';
  /** Decimal exacto en texto. `null` en `no_contado`. */
  readonly cantidad: string | null;
  readonly unidadId: string | null;
  readonly resultadoValidacion: string | null;
  readonly saldoEsperadoCongelado: string | null;
}

export interface Consolidado {
  readonly clasificacion: Clasificacion;
  readonly motivo: MotivoAuditable | null;
  readonly valorFinal: string | null;
  readonly unidadId: string | null;
  readonly origenValor: 'conteo_ciego' | 'auditor' | null;
  readonly rondasAfirmando: number;
  readonly saldoEsperadoCongelado: string | null;
}

/** Los veredictos que significan "esta ronda produjo diferencia". */
const PRODUJO_DIFERENCIA = new Set([
  'alerta_discrepancia',
  'alerta_unidad',
  // El artículo agotó sus verificaciones: llegó ahí porque los intentos previos
  // alertaron, y del último no se sabe. No se puede conciliar lo que no se
  // validó (MAX_VERIFICACIONES en `validacion.ts`).
  'sin_verificacion',
]);

/** El reconteo vigente del Auditor, si lo hubo (FR-4.5). */
export interface ReconteoDeAuditor {
  readonly cantidad: string;
  readonly unidadId: string;
}

export function clasificar(
  afirmaciones: readonly AfirmacionDeRonda[],
  reconteo?: ReconteoDeAuditor | null,
): Consolidado {
  // `no_contado` es ausencia de afirmación, no una cantidad (FR-3.9). Una ronda
  // que lo marcó declaró que el artículo quedó fuera de su alcance, y eso no
  // dice nada sobre lo que hay en el estante.
  const afirmadas = afirmaciones.filter((a) => a.estado !== 'no_contado');

  const base = {
    rondasAfirmando: afirmadas.length,
    // Todas las rondas congelaron el mismo saldo salvo que el ERP haya cambiado
    // entre ellas; se conserva el de la última, que es el más cercano al cierre.
    saldoEsperadoCongelado: afirmadas.at(-1)?.saldoEsperadoCongelado ?? null,
  };

  const auditable = (motivo: MotivoAuditable): Consolidado => ({
    clasificacion: 'auditable',
    motivo,
    // Lo auditable NO lleva valor final MIENTRAS nadie lo haya recontado.
    // Rellenarlo con "lo más probable" sería exactamente la decisión
    // automática que FR-3.4 prohíbe. Cuando el Auditor recuenta, su cifra
    // prevalece sobre la de cualquier Operador (FR-4.5) — y prevalece aquí,
    // en la regla, para que sobreviva a cada reproyección de la bodega.
    valorFinal: reconteo?.cantidad ?? null,
    unidadId: reconteo?.unidadId ?? null,
    origenValor: reconteo ? 'auditor' : null,
    ...base,
  });

  // ── El orden de estas comprobaciones ES la regla ──────────────────────────
  //
  // Cuando varios motivos aplican a la vez se reporta el más específico, y el
  // criterio de especificidad es cuál le dice más al Auditor sobre qué hacer.
  // "Dos personas contaron distinto" manda a recontar con dos versiones que
  // comparar; "no coincide con el sistema" manda a recontar contra una sola.

  if (afirmadas.length === 0) return auditable('sin_cobertura');

  // Comparación EXACTA entre rondas, sin tolerancia. La merma explica que el
  // estante difiera del sistema —evaporación, mermas de corte—, no que dos
  // personas midan cosas distintas el mismo día. Dos cifras distintas son dos
  // observaciones incompatibles, por poco que se separen (escenario 3).
  if (contradicen(afirmadas)) return auditable('contradiccion_entre_rondas');

  // Sin saldo esperado no hay contra qué conciliar. Nunca conciliado (FR-2.10).
  if (afirmadas.every((a) => a.saldoEsperadoCongelado === null)) {
    return auditable('sin_saldo_esperado');
  }

  // FR-3.10, la regla conservadora: basta con que UNA ronda haya producido
  // diferencia, aunque otra coincida. Se mira el vigente de cada ronda, no cada
  // intento (FR-3.6): un conteo que alertó y se corrigió a un valor que
  // coincide no dejó diferencia — la corrección es la respuesta a la alerta.
  if (afirmadas.some((a) => PRODUJO_DIFERENCIA.has(a.resultadoValidacion ?? ''))) {
    return auditable('discrepancia');
  }

  // Todas las rondas afirmaron lo mismo y todas coincidieron con el sistema
  // dentro de tolerancia. Como el Operador nunca pudo ver el saldo esperado,
  // esa coincidencia no se pudo fabricar: contar bien era la única forma de
  // producirla. Esto es D5, y **una sola ronda basta** (FR-3.2, FR-3.5).
  const ultima = afirmadas.at(-1)!;

  return {
    clasificacion: 'conciliado',
    motivo: null,
    // El reconteo manda incluso aquí. Es un caso raro —un artículo que ya
    // concilia no llega a la bandeja— pero puede darse si una ronda posterior
    // lo devuelve a conciliado después de que el Auditor lo tocara, y en ese
    // cruce la regla no puede dudar: el valor del Auditor prevalece (FR-4.5).
    valorFinal: reconteo?.cantidad ?? ultima.cantidad,
    unidadId: reconteo?.unidadId ?? ultima.unidadId,
    origenValor: reconteo ? 'auditor' : 'conteo_ciego',
    ...base,
  };
}

/**
 * ¿Alguna ronda afirmó una cantidad distinta de otra?
 *
 * Se comparan los decimales escalados y no las cadenas: `"5"`, `"5.0"` y
 * `"5.000"` son el mismo número, y Postgres puede devolver cualquiera de las
 * tres según por dónde haya pasado el valor.
 */
function contradicen(afirmadas: readonly AfirmacionDeRonda[]): boolean {
  const valores = new Set(afirmadas.map((a) => aEntero(a.cantidad ?? '0', ESCALA_CANTIDAD)));
  const unidades = new Set(afirmadas.map((a) => a.unidadId));
  return valores.size > 1 || unidades.size > 1;
}
