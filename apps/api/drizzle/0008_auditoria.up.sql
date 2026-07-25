-- 0008 · Auditoría — también LIBRO, también solo inserción.
--
-- El reconteo del Auditor prevalece sobre el del Operador (FR-4.5), pero no lo
-- sobrescribe: se añade. Y si el propio Auditor quiere corregirse, tampoco
-- sobrescribe: supersede con mayor secuencia, igual que cualquier registro.
--
-- (`codigo_razon` ya existe desde 0002: es catálogo de referencia, no libro.)

CREATE TABLE reconteo (
  id                 uuid PRIMARY KEY,
  bodega_id          uuid NOT NULL REFERENCES bodega(id),
  articulo_id        uuid REFERENCES articulo(id),
  fantasma_id        uuid REFERENCES producto_fantasma(id),
  auditor_id         uuid NOT NULL REFERENCES usuario(id),

  -- Mismo mecanismo de supersedencia que el libro de captura.
  secuencia          integer NOT NULL,

  cantidad           numeric(14,3) NOT NULL CHECK (cantidad >= 0),
  unidad_id          uuid NOT NULL REFERENCES unidad_medida(id),

  -- Obligatorio: coincidir con el Operador no exime de explicar por qué había
  -- diferencia (edge case de Historia 4).
  codigo_razon_id    text NOT NULL REFERENCES codigo_razon(id),

  modo_captura       modo_captura NOT NULL,
  capturado_en       timestamptz NOT NULL,
  recibido_en        timestamptz NOT NULL DEFAULT now(),
  clave_idempotencia uuid NOT NULL UNIQUE,

  -- El Auditor auditando una ronda que él mismo ejecutó no se prohíbe: se
  -- SEÑALA y queda en la traza (FR-4.7). Prohibirlo pararía el inventario;
  -- registrarlo deja que alguien lo juzgue después.
  conflicto_independencia boolean NOT NULL DEFAULT false,

  CONSTRAINT reconteo_sobre_algo
    CHECK (articulo_id IS NOT NULL OR fantasma_id IS NOT NULL),
  UNIQUE (bodega_id, articulo_id, secuencia)
);

CREATE INDEX reconteo_vigente_idx
  ON reconteo (bodega_id, articulo_id, secuencia DESC);

CREATE VIEW reconteo_vigente AS
SELECT DISTINCT ON (bodega_id, articulo_id) *
FROM reconteo
ORDER BY bodega_id, articulo_id, secuencia DESC;

CREATE TABLE cierre_inventario (
  bodega_id        uuid PRIMARY KEY REFERENCES bodega(id),
  cerrado_en       timestamptz NOT NULL DEFAULT now(),
  cerrado_por      uuid NOT NULL REFERENCES usuario(id),
  -- Huella del consolidado al momento del cierre: permite demostrar después
  -- que lo enviado al ERP es exactamente lo que se avaló.
  hash_consolidado text NOT NULL
);

GRANT SELECT, INSERT ON reconteo, cierre_inventario TO app_role;
GRANT SELECT ON reconteo_vigente TO app_role;

-- La misma regla de 0004, aplicada a las tablas nuevas.
REVOKE UPDATE, DELETE ON reconteo, cierre_inventario FROM app_role;
