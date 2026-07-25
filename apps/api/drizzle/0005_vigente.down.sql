-- Reversión de 0005. No destruye datos: solo la vista y los índices.

DROP INDEX IF EXISTS ronda_cierre_por_ronda;
DROP INDEX IF EXISTS ronda_por_bodega;
DROP INDEX IF EXISTS saldo_por_bodega_articulo;
DROP INDEX IF EXISTS registro_vigente_idx;

DROP VIEW IF EXISTS registro_vigente;
