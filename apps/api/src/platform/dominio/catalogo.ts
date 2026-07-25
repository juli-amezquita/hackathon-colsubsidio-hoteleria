import type { ArticuloDeTrabajo, OrigenNombre, ResolucionArticulo } from '@cci/contracts';

/**
 * Interfaz PUBLICADA del dominio `catalogo` (Principio III).
 *
 * Es lo único que `captura` puede consumir. Sus tablas, su SQL y sus umbrales
 * le están vedados, y la regla de lint lo verifica en cada build.
 *
 * ⚠️ Fíjate en lo que este contrato NO expone: en ningún método aparece el
 * saldo esperado. No es un olvido — es la frontera. Si algún día alguien lo
 * necesita para el Auditor, se añade un método aparte con su propio control de
 * rol, no un campo opcional aquí.
 */
export interface ProveedorDeCatalogo {
  /** Resuelve el nombre dictado. Devuelve candidatos cuando no está seguro. */
  resolver(bodegaId: string, textoDictado: string): Promise<ResolucionArticulo>;

  /** Catálogo de la bodega. Se cachea en el dispositivo (F-21). Sin saldos. */
  listar(bodegaId: string): Promise<ArticuloDeTrabajo[]>;

  /**
   * Artículos del catálogo cuyo NOMBRE aparece dentro de un texto largo.
   *
   * Es distinto de `resolver`: aquel compara dos nombres, este busca un nombre
   * dentro de una frase. Un hallazgo se describe en una oración —"caja de
   * galletas Festival vainilla x12"— y comparar esa oración entera contra
   * "GALLETAS FESTIVAL" da una similitud baja aunque el artículo esté ahí
   * mismo, nombrado. Sin esto, la comprobación de H5-04 no dispararía nunca.
   */
  contenidosEn(bodegaId: string, texto: string): Promise<ArticuloDeTrabajo[]>;

  /** Un artículo por id, para validar que pertenece a la bodega. */
  buscar(bodegaId: string, articuloId: string): Promise<ArticuloDeTrabajo | null>;

  /**
   * Contexto de validación: saldo esperado y tolerancia vigente.
   *
   * ⚠️ SOLO para uso interno del servidor. Lo consume `captura` para comparar
   * y para congelar el saldo en el registro hijo (D8). **Su resultado no puede
   * viajar en ninguna respuesta dirigida a un Operador** (FR-1.18) — la prueba
   * E2 recorre todas las respuestas para comprobarlo.
   *
   * Ambos valores son decimales EN TEXTO, tal como los entrega Postgres. La
   * comparación con la tolerancia debe ser exacta —el límite justo cae dentro—
   * y convertirlos a `number` aquí rompería esa exactitud antes de que la regla
   * llegue siquiera a mirarlos.
   */
  contextoDeValidacion(
    bodegaId: string,
    articuloId: string,
  ): Promise<{ saldoEsperado: string | null; toleranciaMerma: string | null }>;
}

export const PROVEEDOR_CATALOGO = Symbol('ProveedorDeCatalogo');

export type { OrigenNombre };
