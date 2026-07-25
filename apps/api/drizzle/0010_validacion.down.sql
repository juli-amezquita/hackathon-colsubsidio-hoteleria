DROP VIEW IF EXISTS pendiente_de_resolver;
DROP VIEW IF EXISTS registro_vigente;

DROP TABLE IF EXISTS evidencia_registro;

-- Se restituye la columna que 0010 retiró, para que la ida y la vuelta dejen
-- el esquema exactamente como estaba.
ALTER TABLE registro_conteo
  ADD COLUMN IF NOT EXISTS evidencia_audio_id uuid REFERENCES evidencia_audio(id);

ALTER TABLE registro_conteo DROP CONSTRAINT IF EXISTS advertido_exige_alerta;
ALTER TABLE registro_conteo DROP CONSTRAINT IF EXISTS afirmacion_exige_veredicto;
ALTER TABLE registro_conteo DROP COLUMN IF EXISTS resultado_validacion;

DROP TYPE IF EXISTS resultado_validacion;

-- La vista vuelve a su definición de 0005, ya sin la columna del veredicto.
CREATE VIEW registro_vigente AS
SELECT DISTINCT ON (ronda_id, articulo_id) *
FROM registro_conteo
ORDER BY ronda_id, articulo_id, secuencia DESC;

GRANT SELECT ON registro_vigente TO app_role;
