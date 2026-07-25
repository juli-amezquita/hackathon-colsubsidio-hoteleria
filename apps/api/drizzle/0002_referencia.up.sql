-- 0002 · Tablas de REFERENCIA — la "tabla madre" de D8.
--
-- Para el flujo de conteo son SOLO DE LECTURA: ningún registro de Operador las
-- modifica. Se actualizan únicamente al cerrar el inventario con el aval del
-- Auditor (FR-7.9). Aquí vive lo que el sistema central dice que hay.

CREATE TABLE rol (
  id     text PRIMARY KEY,
  nombre text NOT NULL
);
INSERT INTO rol (id, nombre) VALUES
  ('operador','Operador'), ('auditor','Auditor'), ('administrador','Administrador');

CREATE TABLE usuario (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  documento     text NOT NULL UNIQUE,
  nombre        text NOT NULL,
  -- argon2id (Principio V). PROHIBIDO almacenarla reversible o con hash de
  -- propósito general.
  hash_password text NOT NULL,
  -- El rol se deduce de aquí. El usuario NUNCA lo elige (FR-1.2).
  rol_id        text NOT NULL REFERENCES rol(id),
  activo        boolean NOT NULL DEFAULT true,
  creado_en     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bodega (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo    text NOT NULL UNIQUE,
  -- Concepto genérico: no atado a hoteles ni parques (Principio I).
  nombre    text NOT NULL,
  sede      text,
  activa    boolean NOT NULL DEFAULT true
);

CREATE TABLE usuario_bodega (
  usuario_id uuid NOT NULL REFERENCES usuario(id),
  bodega_id  uuid NOT NULL REFERENCES bodega(id),
  PRIMARY KEY (usuario_id, bodega_id)
);

CREATE TABLE unidad_medida (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo  text NOT NULL UNIQUE,
  nombre  text NOT NULL,
  -- La merma solo aplica a unidades de peso (FR-2.3, supuesto de Historia 2).
  es_peso boolean NOT NULL DEFAULT false
);

CREATE TABLE articulo (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bodega_id          uuid NOT NULL REFERENCES bodega(id),
  -- El identificador principal es el NOMBRE; el código va solo si existe (FR-7.1).
  nombre             text NOT NULL,
  nombre_normalizado text NOT NULL,
  codigo             text,
  unidad_esperada_id uuid NOT NULL REFERENCES unidad_medida(id),
  activo             boolean NOT NULL DEFAULT true,
  UNIQUE (bodega_id, nombre)
);

-- Cómo llama la gente al artículo, que rara vez es como lo llama el ERP (D-19).
-- Es la palanca barata cuando sube la tasa de desambiguación manual.
CREATE TABLE articulo_alias (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  articulo_id       uuid NOT NULL REFERENCES articulo(id),
  bodega_id         uuid NOT NULL REFERENCES bodega(id),
  alias_normalizado text NOT NULL,
  UNIQUE (bodega_id, alias_normalizado, articulo_id)
);

-- ⚠️ NUNCA sale del servidor. El Operador no puede obtenerlo por ningún medio
-- (FR-1.18, verificado por SC-1.3 y la prueba E2). La ceguera ES la garantía
-- que sostiene D5: una coincidencia con este número no se puede fabricar.
CREATE TABLE saldo_esperado (
  bodega_id       uuid NOT NULL REFERENCES bodega(id),
  articulo_id     uuid NOT NULL REFERENCES articulo(id),
  cantidad        numeric(14,3) NOT NULL,
  unidad_id       uuid NOT NULL REFERENCES unidad_medida(id),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bodega_id, articulo_id)
);

-- Catálogo controlado. Ninguna discrepancia se cierra sin causa (R4, FR-4.4).
CREATE TABLE codigo_razon (
  id          text PRIMARY KEY,
  descripcion text NOT NULL,
  activo      boolean NOT NULL DEFAULT true
);

CREATE TABLE configuracion_merma (
  unidad_id  uuid PRIMARY KEY REFERENCES unidad_medida(id),
  porcentaje numeric(6,4) NOT NULL CHECK (porcentaje >= 0 AND porcentaje <= 1),
  vigente_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE configuracion_merma_historial (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unidad_id   uuid NOT NULL REFERENCES unidad_medida(id),
  porcentaje  numeric(6,4) NOT NULL,
  cambiado_por uuid NOT NULL REFERENCES usuario(id),
  cambiado_en timestamptz NOT NULL DEFAULT now()
);

-- Búsqueda del nombre dictado: ruta caliente de cada turno (D-05, D-19).
CREATE INDEX articulo_nombre_trgm ON articulo USING gin (nombre_normalizado gin_trgm_ops);
CREATE INDEX alias_trgm           ON articulo_alias USING gin (alias_normalizado gin_trgm_ops);
CREATE INDEX articulo_por_bodega  ON articulo (bodega_id) WHERE activo;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_role;
GRANT INSERT, UPDATE, DELETE ON
  usuario, bodega, usuario_bodega, unidad_medida, articulo, articulo_alias,
  saldo_esperado, codigo_razon, configuracion_merma, configuracion_merma_historial
TO app_role;
