-- 0007 · PROYECCIÓN — lo que se concluye, no lo que ocurrió.
--
-- Se puede reconstruir entera desde el libro con un comando. Esa es la prueba
-- de que el libro es realmente la fuente de verdad y no un archivo paralelo que
-- alguien dejó de mantener. Si esta tabla se pierde, se regenera; si se pierde
-- el libro, no hay vuelta atrás.

CREATE TYPE clasificacion_articulo AS ENUM ('conciliado', 'auditable');

CREATE TYPE motivo_auditable AS ENUM (
  'discrepancia',
  'contradiccion_entre_rondas',
  'sin_cobertura',
  'sin_saldo_esperado',
  'producto_fantasma'
);

CREATE TYPE origen_valor AS ENUM ('conteo_ciego', 'auditor');

CREATE TABLE articulo_consolidado (
  bodega_id                uuid NOT NULL REFERENCES bodega(id),
  articulo_id              uuid NOT NULL REFERENCES articulo(id),

  clasificacion            clasificacion_articulo NOT NULL,
  motivo_auditable         motivo_auditable,

  valor_final              numeric(14,3),
  unidad_id                uuid REFERENCES unidad_medida(id),
  origen_valor             origen_valor,

  -- Informativo: una sola ronda basta para conciliar (D5). Se conserva porque
  -- el Auditor quiere ver cuántas personas afirmaron algo sobre el artículo.
  rondas_afirmando         integer NOT NULL DEFAULT 0,
  saldo_esperado_congelado numeric(14,3),

  actualizado_en           timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (bodega_id, articulo_id),

  -- Impide que un error de código publique al ERP una cifra que NINGÚN operario
  -- afirmó, o que marque como cerrado algo que el motor considera auditable.
  -- Es la garantía de D5 escrita donde no se puede eludir por descuido.
  CONSTRAINT conciliado_exige_conteo_afirmado
    CHECK (clasificacion <> 'conciliado'
           OR (rondas_afirmando >= 1 AND motivo_auditable IS NULL)),

  -- Auditable sin motivo es una bandeja de trabajo sin explicación.
  CONSTRAINT auditable_exige_motivo
    CHECK (clasificacion <> 'auditable' OR motivo_auditable IS NOT NULL),

  -- Todo valor que sale al ERP declara de dónde viene (FR-7.7).
  CONSTRAINT valor_final_con_origen
    CHECK (valor_final IS NULL OR origen_valor IS NOT NULL)
);

-- La bandeja del Auditor: exclusivamente lo auditable (FR-4.1).
CREATE INDEX consolidado_por_clasificacion
  ON articulo_consolidado (bodega_id, clasificacion);

CREATE TYPE estado_discrepancia AS ENUM ('abierta', 'en_reconteo', 'cerrada');

CREATE TABLE discrepancia (
  id             uuid PRIMARY KEY,
  bodega_id      uuid NOT NULL REFERENCES bodega(id),
  articulo_id    uuid REFERENCES articulo(id),
  fantasma_id    uuid REFERENCES producto_fantasma(id),
  estado         estado_discrepancia NOT NULL DEFAULT 'abierta',
  motivo         motivo_auditable NOT NULL,
  -- Se rellena al cerrar. Ninguna se cierra sin causa (R4, FR-4.4).
  codigo_razon_id text REFERENCES codigo_razon(id),
  abierta_en     timestamptz NOT NULL DEFAULT now(),
  cerrada_en     timestamptz,

  CONSTRAINT discrepancia_sobre_algo
    CHECK (articulo_id IS NOT NULL OR fantasma_id IS NOT NULL),
  CONSTRAINT cerrada_exige_razon
    CHECK (estado <> 'cerrada' OR (codigo_razon_id IS NOT NULL AND cerrada_en IS NOT NULL))
);

CREATE INDEX discrepancia_abierta
  ON discrepancia (bodega_id)
  WHERE estado <> 'cerrada';

GRANT SELECT, INSERT, UPDATE, DELETE ON articulo_consolidado, discrepancia TO app_role;
