-- Revierte 0016.
--
-- Volver a "un cierre por bodega para siempre" solo es posible si no hay
-- ninguna bodega con dos cierres: la clave primaria antigua no los admite. Si
-- los hay, esto falla a propósito en vez de borrar historia.

DROP TABLE IF EXISTS costo_articulo;
DROP TABLE IF EXISTS consolidado_historico;

DROP INDEX IF EXISTS cierre_por_periodo;

ALTER TABLE cierre_inventario DROP CONSTRAINT IF EXISTS un_cierre_por_bodega_y_periodo;
ALTER TABLE cierre_inventario DROP CONSTRAINT IF EXISTS cierre_inventario_pkey;
ALTER TABLE cierre_inventario ADD CONSTRAINT cierre_inventario_pkey PRIMARY KEY (bodega_id);

ALTER TABLE cierre_inventario DROP COLUMN IF EXISTS periodo;
ALTER TABLE cierre_inventario DROP COLUMN IF EXISTS id;
