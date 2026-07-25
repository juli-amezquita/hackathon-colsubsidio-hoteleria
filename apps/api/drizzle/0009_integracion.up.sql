-- 0009 · Salida de datos e integración con el sistema central.
--
-- D8: el conteo NUNCA modifica el inventario original. Esta tabla es la
-- constancia de que algo salió — a un archivo o al ERP — con quién lo hizo y
-- cuándo (FR-7.5).
--
-- (`configuracion_merma` y su historial ya existen desde 0002.)

CREATE TYPE destino_salida AS ENUM ('csv', 'xlsx', 'erp');
CREATE TYPE estado_envio   AS ENUM ('pendiente', 'aceptado', 'parcial', 'fallido');

CREATE TABLE constancia_salida (
  id            uuid PRIMARY KEY,
  bodega_id     uuid NOT NULL REFERENCES bodega(id),
  destino       destino_salida NOT NULL,
  estado        estado_envio NOT NULL DEFAULT 'pendiente',

  -- La misma clave evita el doble movimiento en el sistema central cuando se
  -- reintenta un envío cuyo resultado se desconoce (FR-7.4).
  referencia    text NOT NULL UNIQUE,

  ejecutado_por uuid NOT NULL REFERENCES usuario(id),
  ejecutado_en  timestamptz NOT NULL DEFAULT now(),

  -- Qué se aceptó y qué no. Un envío parcial NUNCA se marca como completo
  -- (edge case de Historia 7).
  articulos_enviados  integer NOT NULL DEFAULT 0,
  articulos_aceptados integer NOT NULL DEFAULT 0,
  respuesta_erp       jsonb,

  CONSTRAINT parcial_es_parcial
    CHECK (estado <> 'aceptado' OR articulos_aceptados = articulos_enviados)
);

CREATE INDEX salida_por_bodega ON constancia_salida (bodega_id, ejecutado_en DESC);

GRANT SELECT, INSERT, UPDATE ON constancia_salida TO app_role;
