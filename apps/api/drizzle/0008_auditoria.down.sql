-- Reversión de 0008. ⚠️ DESTRUYE reconteos y cierres, que son libro.

DROP VIEW IF EXISTS reconteo_vigente;
DROP INDEX IF EXISTS reconteo_vigente_idx;
DROP TABLE IF EXISTS cierre_inventario;
DROP TABLE IF EXISTS reconteo;
