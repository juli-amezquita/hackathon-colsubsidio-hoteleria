-- 0015 · Las propuestas dejan de ser un cálculo y pasan a ser una decisión.
--
-- Hasta aquí el reporte las recalculaba en cada lectura. Eso basta para mirar,
-- y no basta para trabajar: sin estado, nadie puede aprobar algo, nadie sabe
-- qué se rechazó y por qué, y **lo rechazado vuelve a aparecer el mes
-- siguiente** como si fuera nuevo. Un panel que insiste con lo que ya le dijeron
-- que no se deja de leer a la tercera vez.

CREATE TYPE estado_propuesta AS ENUM ('propuesta', 'aprobada', 'rechazada', 'aplicada');

CREATE TABLE propuesta_mejora (
  id           uuid PRIMARY KEY,
  tipo         text NOT NULL,

  -- Identidad estable de la propuesta, derivada de su CONTENIDO.
  --
  -- Es lo que permite que el reporte se ejecute mil veces sin duplicar nada, y
  -- que una propuesta rechazada siga reconociéndose como la misma cuando la
  -- evidencia crece. Sin huella habría que comparar textos, y el texto cambia
  -- en cuanto cambia el número de repeticiones.
  huella       text NOT NULL UNIQUE,

  accion       text NOT NULL,
  evidencia    text NOT NULL,
  veces        integer NOT NULL DEFAULT 1,
  bodega_id    uuid REFERENCES bodega(id),

  -- Datos para aplicarla. NULL cuando la propuesta es trabajo para una persona
  -- —cambiar la gramática es escribir código— y no algo que un clic resuelva.
  aplicable    jsonb,

  estado       estado_propuesta NOT NULL DEFAULT 'propuesta',
  detectada_en timestamptz NOT NULL DEFAULT now(),
  vista_en     timestamptz NOT NULL DEFAULT now(),

  decidida_por uuid REFERENCES usuario(id),
  decidida_en  timestamptz,
  nota         text,
  aplicada_en  timestamptz,

  -- Nada se decide sin que conste quién y cuándo. Es la misma regla que rige
  -- los cambios de tolerancia y los reconteos del Auditor.
  CONSTRAINT decision_con_autor
    CHECK (estado = 'propuesta' OR (decidida_por IS NOT NULL AND decidida_en IS NOT NULL)),

  -- Y solo se marca aplicada lo que de verdad se aplicó.
  CONSTRAINT aplicada_con_momento
    CHECK (estado <> 'aplicada' OR aplicada_en IS NOT NULL)
);

CREATE INDEX propuesta_por_estado ON propuesta_mejora (estado, veces DESC);

-- --------------------------------------------------------------------------
-- La crítica de cada ronda
-- --------------------------------------------------------------------------
--
-- ⚠️ Evalúa al SISTEMA, no a la persona.
--
-- Es la decisión que define esta tabla. Un informe que califica operarios se
-- usa contra ellos, y una herramienta que se usa contra quien la opera se
-- abandona — con ella se pierde el inventario entero. Lo que se mide aquí es
-- dónde falló la máquina: qué no entendió la gramática, qué obligó a
-- desambiguar, qué hubo que corregir.
CREATE TABLE critica_ronda (
  ronda_id     uuid PRIMARY KEY REFERENCES ronda(id),
  bodega_id    uuid NOT NULL REFERENCES bodega(id),

  registros    integer NOT NULL,
  correcciones integer NOT NULL,
  sin_gramatica integer NOT NULL,
  desambiguadas integer NOT NULL,
  discrepantes  integer NOT NULL,

  -- Los puntos flojos, en texto. Deterministas cuando no hay modelo.
  hallazgos    jsonb NOT NULL DEFAULT '[]'::jsonb,
  relato       text,
  critico      text NOT NULL,

  creada_en    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX critica_por_bodega ON critica_ronda (bodega_id, creada_en DESC);

GRANT SELECT, INSERT, UPDATE ON propuesta_mejora TO app_role;
GRANT SELECT, INSERT ON critica_ronda TO app_role;
REVOKE UPDATE, DELETE ON critica_ronda FROM app_role;
