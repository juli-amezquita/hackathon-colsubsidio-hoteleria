-- 0005 · Cómo se supersede un registro sin actualizar nada.
--
-- El diseño intuitivo —una columna `superseded_por` que se rellena al corregir—
-- REQUIERE UN UPDATE, y contradice la propia regla que pretende implementar.
--
-- Con secuencia monótona no hay ninguna escritura sobre una fila existente,
-- jamás: el vigente es simplemente el de secuencia máxima por (ronda, artículo).

CREATE VIEW registro_vigente AS
SELECT DISTINCT ON (ronda_id, articulo_id) *
FROM registro_conteo
ORDER BY ronda_id, articulo_id, secuencia DESC;

-- Sostiene la resolución del vigente, que es ruta caliente.
CREATE INDEX registro_vigente_idx
  ON registro_conteo (ronda_id, articulo_id, secuencia DESC);

-- Validación en servidor contra el saldo esperado (FR-2.2).
CREATE INDEX saldo_por_bodega_articulo
  ON saldo_esperado (bodega_id, articulo_id);

-- Rondas de una persona en una bodega: se consulta al retomar el conteo tras
-- cerrar el navegador o quedarse sin batería (edge case de Historia 1).
CREATE INDEX ronda_por_bodega
  ON ronda (bodega_id, operador_id, abierta_en DESC);

-- Sin fila en `ronda_cierre`, la ronda sigue abierta. Este índice parcial hace
-- barata la pregunta "¿cuáles quedaron abiertas?".
CREATE INDEX ronda_cierre_por_ronda ON ronda_cierre (ronda_id);

GRANT SELECT ON registro_vigente TO app_role;
