/**
 * Decimales exactos sobre `BigInt`.
 *
 * Vive en `platform/` y no dentro de un dominio porque lo necesitan dos:
 * `captura` para comparar contra la tolerancia de merma y `consolidacion` para
 * comparar cantidades entre rondas. Que un dominio importara del otro rompería
 * la frontera del Principio III por una función de cuatro líneas.
 *
 * ⚠️ Nada de esto pasa por `number` en ningún punto. Postgres devuelve `numeric`
 * como cadena precisamente para no perder dígitos; convertirla a coma flotante
 * para volver a escalarla desharía esa garantía en la primera línea.
 */

/** Escalas de las columnas del esquema: `numeric(14,3)` y `numeric(6,4)`. */
export const ESCALA_CANTIDAD = 3;
export const ESCALA_TOLERANCIA = 4;

export const abs = (v: bigint): bigint => (v < 0n ? -v : v);

/**
 * Decimal en texto → entero escalado. `"12.5"` con escala 3 → `12500n`.
 *
 * Tolera lo que Postgres puede devolver para el mismo número —`"5"`, `"5.0"`,
 * `"5.000"`— porque el valor viaja por columnas de escalas distintas según el
 * camino, y compararlos como cadenas daría tres números diferentes.
 */
export function aEntero(valor: string, escala: number): bigint {
  const limpio = valor.trim();
  const negativo = limpio.startsWith('-');
  const [entera = '0', decimal = ''] = limpio.replace(/^[+-]/, '').split('.');

  const ajustada = decimal.length > escala
    ? decimal.slice(0, escala) // Postgres ya redondeó a la escala de la columna.
    : decimal.padEnd(escala, '0');

  const magnitud = BigInt(entera || '0') * 10n ** BigInt(escala) + BigInt(ajustada || '0');
  return negativo ? -magnitud : magnitud;
}

/**
 * `|contado − esperado| ≤ |esperado| × tolerancia`, en aritmética exacta.
 *
 * El caso "diferencia exactamente igual al límite" es un edge case explícito de
 * la especificación y debe caer DENTRO. En coma flotante ese caso lo decide el
 * último bit de la mantisa, y lo decidiría distinto según el artículo. Aquí
 * `≤` significa `≤`.
 *
 * El valor absoluto del esperado importa: el archivo real del cliente trae 79
 * saldos negativos. Con un esperado negativo, un `esperado × tolerancia` sin
 * `abs` daría un límite negativo y ninguna diferencia cabría jamás.
 */
export function dentroDeTolerancia(contado: string, esperado: string, tolerancia: string): boolean {
  const c = aEntero(contado, ESCALA_CANTIDAD);
  const e = aEntero(esperado, ESCALA_CANTIDAD);
  const t = aEntero(tolerancia, ESCALA_TOLERANCIA);

  // Se multiplica en vez de dividir: dividir truncaría y movería el límite.
  return abs(c - e) * 10n ** BigInt(ESCALA_TOLERANCIA) <= abs(e) * t;
}
