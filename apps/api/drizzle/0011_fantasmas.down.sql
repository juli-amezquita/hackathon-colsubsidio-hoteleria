DROP INDEX IF EXISTS reconteo_fantasma_secuencia;
DROP INDEX IF EXISTS discrepancia_por_fantasma;
DROP INDEX IF EXISTS fantasma_por_bodega;

ALTER TABLE producto_fantasma DROP COLUMN IF EXISTS bodega_id;
ALTER TABLE producto_fantasma DROP COLUMN IF EXISTS candidatos_catalogo;
