-- Revierte 0017. Las filas duplicadas que borró el `up` no vuelven: eran
-- basura, no historia.

DROP INDEX IF EXISTS registro_por_articulo;
DROP INDEX IF EXISTS discrepancia_por_articulo;
