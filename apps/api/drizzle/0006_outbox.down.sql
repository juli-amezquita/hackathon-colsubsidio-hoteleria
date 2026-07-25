-- Reversión de 0006. ⚠️ Descarta eventos no despachados.

DROP INDEX IF EXISTS outbox_pendiente;
DROP TABLE IF EXISTS evento_procesado;
DROP TABLE IF EXISTS outbox;
