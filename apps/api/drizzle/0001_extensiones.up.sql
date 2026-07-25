-- 0001 · Extensiones y rol de la aplicación
-- Reversible: el down elimina extensiones y rol. No destruye datos (no hay ninguno todavía).

-- Similitud por trigramas: resuelve el nombre dictado contra el catálogo (D-19).
-- Es la ruta caliente de cada turno de conteo, no una función auxiliar.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- gen_random_uuid() y digest() para los sellos.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Rol con el que corre la aplicación. La migración 0004 le REVOCA UPDATE y DELETE
-- sobre las tablas del libro: la inmutabilidad vive en el motor, no en el código,
-- para que un UPDATE por descuido falle en producción y no en la revisión (D-13).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_role') THEN
    CREATE ROLE app_role NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_role;
