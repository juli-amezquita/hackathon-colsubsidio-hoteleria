-- 0006 · Outbox transaccional (D-14, Principio IV).
--
-- La regla es literal: el evento y el dato que lo origina se escriben en la
-- MISMA transacción. Si el conteo se guarda y el evento no se emite —o al
-- revés— el sistema queda inconsistente sin ninguna señal de error.
--
-- ⚠️ El outbox NO es parte del libro, aunque viva al lado. Es transporte:
-- `despachado_en` se marca al entregar, y eso exige UPDATE. Lo que el Principio
-- IV pide del outbox es ATOMICIDAD con su causa, no inmutabilidad. Por eso no
-- aparece en la revocación de la 0004.

CREATE TABLE outbox (
  id            uuid PRIMARY KEY,
  tipo_evento   text NOT NULL,
  -- Versionado aditivo: añadir un campo no la incrementa; cambiar el
  -- significado de uno existente, sí (contrato de eventos, regla 3).
  version       integer NOT NULL DEFAULT 1,
  payload       jsonb NOT NULL,
  actor_id      uuid REFERENCES usuario(id),
  ocurrido_en   timestamptz NOT NULL DEFAULT now(),
  despachado_en timestamptz,
  intentos      integer NOT NULL DEFAULT 0,
  ultimo_error  text
);

-- Índice PARCIAL: el despachador solo pregunta por lo pendiente, y lo pendiente
-- es una fracción diminuta de la tabla. Un índice completo crecería sin límite
-- para responder siempre la misma pregunta.
CREATE INDEX outbox_pendiente
  ON outbox (ocurrido_en)
  WHERE despachado_en IS NULL;

-- Un consumidor que recibe dos veces el mismo evento produce UN efecto.
-- Se registra aquí, en la misma transacción que el efecto (contrato, regla 1).
CREATE TABLE evento_procesado (
  consumidor   text NOT NULL,
  event_id     uuid NOT NULL,
  procesado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumidor, event_id)
);

GRANT SELECT, INSERT, UPDATE ON outbox TO app_role;
GRANT SELECT, INSERT ON evento_procesado TO app_role;
