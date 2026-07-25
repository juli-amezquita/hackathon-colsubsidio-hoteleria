/**
 * Fuente única de contratos (D-22, Principio VI).
 *
 * REGLA NO NEGOCIABLE: este paquete contiene **solo** esquemas, tipos y
 * constantes. Está PROHIBIDO que acumule reglas de negocio — sería la "capa de
 * utilidades compartidas" que el Principio III veta. Si una función decide algo
 * sobre el dominio, no va aquí: va en su módulo.
 *
 * De estos esquemas se derivan los tipos de TypeScript, la validación en runtime
 * del servidor y el documento OpenAPI (`pnpm contracts:generate`).
 *
 * Es también la ENTREGA hacia el frontend, que lo desarrolla otro equipo: la
 * frontera entre los dos es este paquete y el OpenAPI que sale de él.
 */

export * from './comun';
export * from './salud';
export * from './sesion';
export * from './catalogo';
export * from './captura';
export * from './consolidacion';
export * from './eventos';
