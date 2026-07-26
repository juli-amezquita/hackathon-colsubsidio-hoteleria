-- 0017 · La unicidad que faltaba, y dos índices de ruta caliente.
--
-- `consolidacion.service.ts` abre la discrepancia de un artículo con un
-- `INSERT ... WHERE NOT EXISTS`: comprueba y luego actúa, en dos pasos, bajo
-- READ COMMITTED. El despachador del outbox está diseñado a propósito para
-- correr en varias réplicas (`FOR UPDATE SKIP LOCKED`), así que dos réplicas
-- reproyectando la misma bodega a la vez pasan las DOS la comprobación e
-- insertan las DOS.
--
-- El daño no se queda ahí. `IntegracionService.consolidado()` hace
-- `LEFT JOIN discrepancia`: con dos filas, el artículo aparece DOS VECES en el
-- consolidado, sale duplicado en el CSV que firma el Auditor, se envía dos
-- veces al ERP y cambia la huella que sostiene FR-7.4.
--
-- El índice equivalente para hallazgos ya existía desde 0011
-- (`discrepancia_por_fantasma`); el de artículos nunca se creó.

-- Si ya hay duplicados —una base que estuvo corriendo con réplicas— se
-- conserva la MÁS ANTIGUA: es la que el Auditor pudo haber empezado a
-- trabajar, y su identificador es el que viaja en cualquier enlace.
DELETE FROM discrepancia d
 WHERE d.articulo_id IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM discrepancia otra
      WHERE otra.bodega_id = d.bodega_id
        AND otra.articulo_id = d.articulo_id
        AND (otra.abierta_en, otra.id) < (d.abierta_en, d.id));

CREATE UNIQUE INDEX discrepancia_por_articulo
  ON discrepancia (bodega_id, articulo_id)
  WHERE articulo_id IS NOT NULL;

-- Ruta caliente 1: `reproyectar` pregunta "¿ya existe discrepancia?" UNA VEZ
-- POR ARTÍCULO. Son ~1.400 por bodega en el archivo del cliente, y hasta ahora
-- el único índice era parcial sobre las no cerradas, que no sirve para esa
-- pregunta. El índice único de arriba ya la resuelve.

-- Ruta caliente 2: abrir un caso del Auditor filtra por artículo dentro de una
-- bodega. Sin esto se recorre el libro entero de conteos para ver uno solo.
CREATE INDEX registro_por_articulo ON registro_conteo (articulo_id);
