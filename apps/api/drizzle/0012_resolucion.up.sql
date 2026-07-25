-- 0012 · La resolución del nombre viaja con el conteo (FR-6.9).
--
-- Sin red, el dispositivo resuelve el nombre dictado contra el catálogo que
-- tiene cacheado. Es lo que permite seguir contando en una bodega sin señal —y
-- lo que abre el único hueco serio del modelo offline: el catálogo del
-- dispositivo puede estar desactualizado, o su versión de la gramática puede
-- diferir de la del servidor.
--
-- La respuesta fácil sería que el servidor corrija al sincronizar. Sería
-- silenciosa, y el operario nunca sabría que el artículo que él contó no es el
-- que quedó guardado. Así que el servidor RESUELVE OTRA VEZ, con autoridad, y
-- cuando su respuesta difiere de la del dispositivo no toca el dato: marca la
-- fila y la manda al Auditor con las dos resoluciones a la vista.

ALTER TABLE registro_conteo
  -- El texto crudo tal como se dictó. Es lo que hace posible re-resolver: sin
  -- él, el servidor solo tendría el id que el dispositivo eligió y no habría
  -- nada que contrastar.
  ADD COLUMN texto_dictado text,
  -- A qué artículo llegó el SERVIDOR con ese mismo texto.
  ADD COLUMN articulo_servidor uuid REFERENCES articulo(id),
  ADD COLUMN resolucion_discrepante boolean NOT NULL DEFAULT false;

-- Sin texto dictado no hay nada que contrastar, así que no puede haber
-- discrepancia de resolución.
ALTER TABLE registro_conteo
  ADD CONSTRAINT discrepancia_resolucion_exige_texto
  CHECK (NOT resolucion_discrepante OR texto_dictado IS NOT NULL);

-- Un motivo propio en la bandeja del Auditor. Meterlo bajo 'discrepancia'
-- mezclaría dos problemas distintos: uno se resuelve contando otra vez, este
-- se resuelve mirando a qué artículo se refería la persona.
ALTER TYPE motivo_auditable ADD VALUE IF NOT EXISTS 'resolucion_discrepante';

CREATE INDEX registro_resolucion_discrepante
  ON registro_conteo (ronda_id) WHERE resolucion_discrepante;

-- `registro_vigente` se definió con `SELECT *`, que Postgres expande al crear
-- la vista: sin recrearla no vería las columnas nuevas. Y `pendiente_de_resolver`
-- depende de ella, así que cae y se rehace igual.
DROP VIEW pendiente_de_resolver;
DROP VIEW registro_vigente;

CREATE VIEW registro_vigente AS
SELECT DISTINCT ON (ronda_id, articulo_id) *
FROM registro_conteo
ORDER BY ronda_id, articulo_id, secuencia DESC;

CREATE VIEW pendiente_de_resolver AS
SELECT v.ronda_id,
       v.id AS registro_id,
       v.articulo_id,
       v.resultado_validacion,
       v.advertido,
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
