import { dentroDeTolerancia } from '../../platform/numeros/decimal';

/**
 * H2-01 a H2-04 · Las reglas de validación.
 *
 * Función pura, sin base de datos y sin red: entra el conteo y el contexto,
 * sale el veredicto. Es lo que permite probar el límite exacto de la tolerancia
 * sin levantar nada, y lo que hace que el resultado sea idéntico venga el dato
 * por voz o por texto (FR-2.5, escenario 8).
 *
 * **Aquí no participa ningún modelo de lenguaje** (FR-2.6, Restricción 1). Si
 * un dato es válido o no es una condición, no una opinión: dos ejecuciones con
 * la misma entrada dan el mismo resultado, hoy y dentro de un año.
 */

export type Veredicto =
  | 'aceptado'
  | 'alerta_unidad'
  | 'alerta_discrepancia'
  | 'no_validable'
  | 'sin_verificacion';

/**
 * Cuántas veces se valida un mismo artículo dentro de una ronda.
 *
 * ⚠️ Este número es una medida de seguridad, no una comodidad — y sin él la
 * ceguera de FR-1.18 se cae por completo.
 *
 * La alerta es un oráculo: responde sí o no sobre "¿mi número cae dentro de la
 * banda?". Con reintentos ilimitados, un operario que quisiera averiguar el
 * saldo del sistema solo tendría que buscar la banda por bisección — y en una
 * decena de intentos la encontraría. Toda la garantía de que "una coincidencia
 * no se puede fabricar" se evaporaría.
 *
 * Se cierra por dos vías a la vez:
 *
 *   1. **La alerta nunca dice la dirección.** Sin saber si sobra o falta, cada
 *      intento vale un bit inútil: no indica hacia dónde moverse. Es la razón
 *      por la que el veredicto no distingue "de más" de "de menos", aunque el
 *      servidor sí lo sepa.
 *   2. **Los intentos se agotan.** Al tercero el sistema deja de responder. Tres
 *      bits sin dirección no localizan nada.
 *
 * No cuesta nada al operario honesto: un artículo que necesitó tres conteos ya
 * es auditable por la regla conservadora de FR-3.10, así que dejar de validarlo
 * no le quita ninguna verificación que fuera a cambiar su destino.
 */
export const MAX_VERIFICACIONES = 3;

export interface ContextoValidacion {
  readonly estado: 'contado' | 'contado_en_cero' | 'no_contado';
  /** Decimal exacto tal cual viene de Postgres. NUNCA un `number`. */
  readonly cantidad: string | null;
  readonly unidadId: string | null;
  readonly unidadEsperadaId: string;
  readonly esPeso: boolean;
  readonly saldoEsperado: string | null;
  readonly toleranciaMerma: string | null;
  /** Cuántas veces se validó ya este artículo en esta ronda. */
  readonly verificacionesPrevias: number;
}

export interface Resultado {
  readonly veredicto: Veredicto;
  /** Se congela en la fila: es la tolerancia vigente AL CONTAR (FR-8.2). */
  readonly toleranciaAplicada: string | null;
  readonly esAlerta: boolean;
}

export function validar(ctx: ContextoValidacion): Resultado {
  // `no_contado` declara que el artículo quedó fuera del alcance. No es una
  // afirmación sobre la realidad física, así que no hay nada contra qué
  // compararlo y no puede generar discrepancia (FR-2.7, escenario 10).
  if (ctx.estado === 'no_contado') {
    return { veredicto: 'no_validable', toleranciaAplicada: null, esAlerta: false };
  }

  if (ctx.verificacionesPrevias >= MAX_VERIFICACIONES) {
    return { veredicto: 'sin_verificacion', toleranciaAplicada: null, esAlerta: false };
  }

  // La unidad va primero y corta. Comparar 20 unidades contra 20 kilos no da
  // una discrepancia: da una comparación sin sentido. Decir cuál es la unidad
  // correcta (FR-2.1) no filtra nada — es dato del catálogo que el dispositivo
  // ya tiene cacheado (F-21).
  if (ctx.unidadId !== ctx.unidadEsperadaId) {
    return { veredicto: 'alerta_unidad', toleranciaAplicada: null, esAlerta: true };
  }

  // Sin saldo esperado no hay contra qué validar. El conteo se guarda igual y
  // el artículo queda para el Auditor: descartarlo sería perder el único dato
  // real que existe sobre ese estante (FR-2.10).
  if (ctx.saldoEsperado === null) {
    return { veredicto: 'no_validable', toleranciaAplicada: null, esAlerta: false };
  }

  // La merma solo aplica a lo que se mide por peso (FR-2.3). Para lo que se
  // cuenta por unidades, cualquier diferencia alerta: no hay evaporación de
  // botellas (escenario 5).
  //
  // Y una unidad de peso SIN merma configurada aplica tolerancia cero. La fila
  // queda con `es_peso = true` y `tolerancia_aplicada = 0`, que es la huella de
  // que faltaba configurarla — visible, no silenciosa.
  const tolerancia = ctx.esPeso ? (ctx.toleranciaMerma ?? '0') : '0';

  const dentro = dentroDeTolerancia(ctx.cantidad ?? '0', ctx.saldoEsperado, tolerancia);

  return {
    veredicto: dentro ? 'aceptado' : 'alerta_discrepancia',
    toleranciaAplicada: tolerancia,
    esAlerta: !dentro,
  };
}
