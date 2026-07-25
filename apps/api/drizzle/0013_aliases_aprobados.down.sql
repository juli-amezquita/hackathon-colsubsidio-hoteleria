DROP INDEX IF EXISTS alias_unico_por_bodega;

ALTER TABLE articulo_alias
  DROP COLUMN IF EXISTS creado_en,
  DROP COLUMN IF EXISTS creado_por;
