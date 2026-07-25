-- Reversión de 0004. Devuelve permisos; NO borra ninguna fila.
-- (Regla 1 de reversibilidad: ninguna migración destruye datos en su `down`
-- sin decirlo explícitamente en la cabecera.)

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT UPDATE, DELETE ON TABLES TO app_role;

GRANT UPDATE, DELETE ON
  ronda,
  ronda_cierre,
  registro_conteo,
  producto_fantasma,
  evidencia_audio
TO app_role;
