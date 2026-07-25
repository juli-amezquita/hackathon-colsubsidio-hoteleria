-- Reversión de 0007. No destruye nada irrecuperable: la proyección se
-- reconstruye desde el libro. Esa es precisamente su definición.

DROP INDEX IF EXISTS discrepancia_abierta;
DROP INDEX IF EXISTS consolidado_por_clasificacion;

DROP TABLE IF EXISTS discrepancia;
DROP TABLE IF EXISTS articulo_consolidado;

DROP TYPE IF EXISTS estado_discrepancia;
DROP TYPE IF EXISTS origen_valor;
DROP TYPE IF EXISTS motivo_auditable;
DROP TYPE IF EXISTS clasificacion_articulo;
