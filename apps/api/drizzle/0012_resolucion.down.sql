DROP VIEW IF EXISTS pendiente_de_resolver;
DROP VIEW IF EXISTS registro_vigente;

DROP INDEX IF EXISTS registro_resolucion_discrepante;

ALTER TABLE registro_conteo DROP CONSTRAINT IF EXISTS discrepancia_resolucion_exige_texto;
ALTER TABLE registro_conteo
  DROP COLUMN IF EXISTS resolucion_discrepante,
  DROP COLUMN IF EXISTS articulo_servidor,
  DROP COLUMN IF EXISTS texto_dictado;

-- El valor del enum NO se quita: Postgres no permite eliminar valores de un
-- enum, y forzarlo exigiría recrear el tipo y todas sus columnas. Queda sin
-- usar, que es inocuo.

CREATE VIEW registro_vigente AS
SELECT DISTINCT ON (ronda_id, articulo_id) *
FROM registro_conteo
ORDER BY ronda_id, articulo_id, secuencia DESC;

CREATE VIEW pendiente_de_resolver AS
SELECT v.ronda_id, v.id AS registro_id, v.articulo_id, v.resultado_validacion, v.advertido,
       CASE
         WHEN v.resultado_validacion IN ('alerta_unidad', 'alerta_discrepancia')
              AND NOT v.advertido                          THEN 'alerta_sin_responder'
         ELSE                                                   'evidencia_faltante'
       END AS motivo
FROM registro_vigente v
LEFT JOIN evidencia_registro e ON e.registro_id = v.id
WHERE (v.resultado_validacion IN ('alerta_unidad', 'alerta_discrepancia') AND NOT v.advertido)
   OR (v.advertido AND v.modo_captura = 'voz' AND e.registro_id IS NULL);

GRANT SELECT ON registro_vigente, pendiente_de_resolver TO app_role;
