-- 0003 · El LIBRO — solo inserción (D2, FR-1.13).
--
-- Nada se actualiza en sitio. Una corrección no sobrescribe: AÑADE una fila con
-- mayor número de secuencia, y ambas quedan en la traza. Sobrescribir destruiría
-- la contabilidad de las rondas, que es justamente lo que se quiere conservar.
--
-- La 0004 revoca UPDATE y DELETE aquí. Esta migración solo crea la estructura.

CREATE TYPE estado_registro AS ENUM ('contado', 'contado_en_cero', 'no_contado');
CREATE TYPE modo_captura    AS ENUM ('voz', 'texto');
CREATE TYPE origen_parse    AS ENUM ('gramatica', 'modelo', 'manual');
CREATE TYPE origen_nombre   AS ENUM ('exacto', 'similitud', 'alias', 'seleccion_usuario');

-- El recorrido de UNA persona sobre UNA bodega. Las rondas no se pisan entre sí
-- ni se fusionan, ni siquiera entre ejercicios distintos de la misma persona (D2).
CREATE TABLE ronda (
  id               uuid PRIMARY KEY,
  bodega_id        uuid NOT NULL REFERENCES bodega(id),
  operador_id      uuid NOT NULL REFERENCES usuario(id),
  abierta_en       timestamptz NOT NULL DEFAULT now(),
  -- Desfase medido al abrir, para poder leer `capturado_en` con criterio (D-16).
  desfase_reloj_ms integer NOT NULL DEFAULT 0
);

-- El cierre NO es un UPDATE sobre `ronda`: es una fila aquí.
-- Su existencia ES el estado cerrado.
CREATE TABLE ronda_cierre (
  ronda_id    uuid PRIMARY KEY REFERENCES ronda(id),
  cerrada_en  timestamptz NOT NULL DEFAULT now(),
  cerrada_por uuid NOT NULL REFERENCES usuario(id)
);

-- Nunca contiene el audio, solo dónde quedó. Se sube diferido y SOLO para los
-- turnos en disputa (~10%): la voz es dato personal y el Principio V exige
-- minimización.
CREATE TABLE evidencia_audio (
  id        uuid PRIMARY KEY,
  clave_s3  text NOT NULL,
  subido_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE registro_conteo (
  id                       uuid PRIMARY KEY,
  ronda_id                 uuid NOT NULL REFERENCES ronda(id),
  articulo_id              uuid NOT NULL REFERENCES articulo(id),
  -- Monótono por ronda. El VIGENTE es el de secuencia máxima por
  -- (ronda, artículo). No hay columna `superseded_por` a propósito: rellenarla
  -- exigiría un UPDATE y contradiría la regla que pretende implementar.
  secuencia                integer NOT NULL,

  estado                   estado_registro NOT NULL,
  cantidad                 numeric(14,3),
  unidad_id                uuid REFERENCES unidad_medida(id),

  -- La mitad "heredada" del registro hijo: qué decía el sistema en ese momento
  -- (D8, FR-1.26). Vive junto a lo contado, para responder "qué esperaba el
  -- sistema y qué encontró la gente" leyendo UNA fila.
  -- ⚠️ NUNCA se sirve al cliente del Operador (FR-1.18).
  saldo_esperado_congelado numeric(14,3),
  tolerancia_aplicada      numeric(6,4),

  -- Evidencia de auditoría, no telemetría opcional (R3, FR-1.12).
  modo_captura             modo_captura NOT NULL,
  origen_parse             origen_parse NOT NULL DEFAULT 'manual',
  origen_nombre            origen_nombre,

  -- Dos tiempos, ambos almacenados (D-16). El orden dentro de la ronda es del
  -- cliente —monótono aunque no haya red—; la autoridad legal es del servidor.
  capturado_en             timestamptz NOT NULL,
  recibido_en              timestamptz NOT NULL DEFAULT now(),

  -- Reintentos seguros por construcción: ON CONFLICT DO NOTHING (R2, FR-6.2).
  clave_idempotencia       uuid NOT NULL UNIQUE,

  advertido                boolean NOT NULL DEFAULT false,
  evidencia_audio_id       uuid REFERENCES evidencia_audio(id),

  UNIQUE (ronda_id, articulo_id, secuencia),

  -- `no_contado` es ausencia de afirmación, no una cantidad (FR-3.9).
  CONSTRAINT no_contado_sin_cantidad
    CHECK (estado <> 'no_contado' OR (cantidad IS NULL AND unidad_id IS NULL)),
  -- Contar SÍ es afirmar: exige cantidad y unidad.
  CONSTRAINT contado_exige_cantidad
    CHECK (estado = 'no_contado' OR (cantidad IS NOT NULL AND unidad_id IS NOT NULL)),
  -- No existe el conteo negativo (edge case de Historia 2).
  CONSTRAINT cantidad_no_negativa
    CHECK (cantidad IS NULL OR cantidad >= 0)
);

-- Hallazgo físico sin correspondencia en el catálogo (FR-5.x).
CREATE TABLE producto_fantasma (
  id                 uuid PRIMARY KEY,
  ronda_id           uuid NOT NULL REFERENCES ronda(id),
  -- "Descripción detallada", no un nombre genérico (FR-5.2). El umbral objetivo
  -- lo confirma el negocio (G-4); 20 caracteres es el mínimo provisional.
  descripcion        text NOT NULL CHECK (length(trim(descripcion)) >= 20),
  unidad_observada   text NOT NULL,
  cantidad           numeric(14,3) NOT NULL CHECK (cantidad >= 0),
  modo_captura       modo_captura NOT NULL,
  capturado_en       timestamptz NOT NULL,
  recibido_en        timestamptz NOT NULL DEFAULT now(),
  clave_idempotencia uuid NOT NULL UNIQUE,
  evidencia_audio_id uuid REFERENCES evidencia_audio(id)
);

GRANT SELECT, INSERT ON
  ronda, ronda_cierre, registro_conteo, producto_fantasma, evidencia_audio
TO app_role;
