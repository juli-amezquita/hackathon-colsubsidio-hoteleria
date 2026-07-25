-- Reversión de 0001. No destruye datos de negocio.

-- Un rol no se puede eliminar mientras algo dependa de él, y las migraciones
-- posteriores le dejan privilegios por defecto y GRANTs sobre tablas.
-- `DROP OWNED BY` retira todo eso de una vez; sin esto, la reversión completa
-- falla en el último paso — que es exactamente lo que detectó `db:verificar`.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM app_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM app_role;
DROP OWNED BY app_role;

REVOKE USAGE ON SCHEMA public FROM app_role;
DROP ROLE IF EXISTS app_role;

DROP EXTENSION IF EXISTS pgcrypto;
DROP EXTENSION IF EXISTS pg_trgm;
