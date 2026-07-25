-- 0011 · Productos fantasma (Historia 5).
--
-- La tabla ya existe desde 0003. Lo que falta es lo que el hallazgo necesita
-- para llegar completo al Auditor.

-- Qué le propuso el catálogo al operario ANTES de que registrara el hallazgo.
--
-- El sistema busca por `pg_trgm` y, si encuentra algo parecido, se lo muestra:
-- la mayoría de los "fantasmas" son un nombre mal dicho, no mercancía sin
-- registrar. Cuando el operario responde que no es ninguno de esos, la lista
-- que rechazó se guarda AQUÍ.
--
-- No es telemetría. Es la diferencia entre que el Auditor lea "apareció algo
-- llamado X" y que lea "apareció algo llamado X, el sistema le ofreció estos
-- tres artículos y la persona que lo tenía en la mano dijo que no era ninguno".
-- Lo segundo es evidencia; lo primero es una nota al margen.
ALTER TABLE producto_fantasma
  ADD COLUMN candidatos_catalogo jsonb NOT NULL DEFAULT '[]'::jsonb;

-- El hallazgo pertenece a una bodega a través de su ronda. Se materializa para
-- que la bandeja del Auditor no tenga que unir tres tablas en la ruta caliente.
ALTER TABLE producto_fantasma
  ADD COLUMN bodega_id uuid REFERENCES bodega(id);

UPDATE producto_fantasma pf
   SET bodega_id = r.bodega_id
  FROM ronda r
 WHERE r.id = pf.ronda_id AND pf.bodega_id IS NULL;

ALTER TABLE producto_fantasma ALTER COLUMN bodega_id SET NOT NULL;

CREATE INDEX fantasma_por_bodega ON producto_fantasma (bodega_id);

-- Un hallazgo, una discrepancia. NUNCA se fusionan los de rondas distintas
-- (FR-5.5): dos personas que describen lo mismo con palabras distintas pueden
-- estar describiendo dos cosas, y decidirlo es del Auditor, no del sistema.
CREATE UNIQUE INDEX discrepancia_por_fantasma
  ON discrepancia (fantasma_id) WHERE fantasma_id IS NOT NULL;

-- El reconteo del Auditor sobre un fantasma supersede igual que el de un
-- artículo. 0008 solo declaró la unicidad para `articulo_id`.
CREATE UNIQUE INDEX reconteo_fantasma_secuencia
  ON reconteo (fantasma_id, secuencia) WHERE fantasma_id IS NOT NULL;
