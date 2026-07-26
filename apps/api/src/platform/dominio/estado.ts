/**
 * Lo que el modo consulta puede leer. **Y nada más.**
 *
 * Este archivo es la superficie de seguridad de la Historia extra. El
 * supervisor pregunta en voz natural y un modelo interpreta la pregunta — pero
 * el modelo no consulta la base: elige entre estas operaciones, todas de solo
 * lectura y todas devolviendo lo que ya devuelven las pantallas existentes.
 *
 * La diferencia con darle acceso a la base, o con un RAG sobre todo el
 * inventario, es que aquí **la superficie es enumerable**: se puede leer esta
 * lista y saber exactamente qué puede llegar a decir el agente. Con SQL libre o
 * con recuperación semántica, la respuesta a "¿qué puede filtrar?" sería "hay
 * que probarlo", que no es una respuesta.
 *
 * ⚠️ Todo esto incluye saldos y diferencias. Es información de supervisión, no
 * de conteo: ninguna de estas rutas puede quedar al alcance de un Operador
 * (FR-1.18).
 */

export interface EstadoDeBodega {
  readonly conciliados: number;
  readonly auditables: number;
  readonly rondasCerradas: number;
  readonly total: number;
  readonly porMotivo: Readonly<Record<string, number>>;
}

export interface ProveedorDeEstado {
  estadoDeBodega(bodegaId: string): Promise<EstadoDeBodega>;
}

export interface PendienteDeAuditoria {
  readonly nombre: string;
  readonly motivo: string;
}

export interface ProveedorDePendientes {
  pendientesDeBodega(bodegaId: string): Promise<readonly PendienteDeAuditoria[]>;
}

export interface SalidaRegistrada {
  readonly destino: string;
  readonly estado: string;
  readonly usuario: string;
  readonly ejecutadoEn: string;
  readonly enviadas: number;
}

export interface ProveedorDeSalidas {
  salidasDeBodega(bodegaId: string): Promise<readonly SalidaRegistrada[]>;
}

export const PROVEEDOR_ESTADO = Symbol('ProveedorDeEstado');
export const PROVEEDOR_PENDIENTES = Symbol('ProveedorDePendientes');
export const PROVEEDOR_SALIDAS = Symbol('ProveedorDeSalidas');
