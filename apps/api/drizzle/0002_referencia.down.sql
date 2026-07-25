-- Reversión de 0002. ⚠️ DESTRUYE DATOS de referencia (catálogo, saldos, usuarios).
-- Solo se ejecuta hacia atrás en un entorno reproducible, nunca en producción
-- con datos vivos.

DROP INDEX IF EXISTS articulo_por_bodega;
DROP INDEX IF EXISTS alias_trgm;
DROP INDEX IF EXISTS articulo_nombre_trgm;

DROP TABLE IF EXISTS configuracion_merma_historial;
DROP TABLE IF EXISTS configuracion_merma;
DROP TABLE IF EXISTS codigo_razon;
DROP TABLE IF EXISTS saldo_esperado;
DROP TABLE IF EXISTS articulo_alias;
DROP TABLE IF EXISTS articulo;
DROP TABLE IF EXISTS unidad_medida;
DROP TABLE IF EXISTS usuario_bodega;
DROP TABLE IF EXISTS bodega;
DROP TABLE IF EXISTS usuario;
DROP TABLE IF EXISTS rol;
