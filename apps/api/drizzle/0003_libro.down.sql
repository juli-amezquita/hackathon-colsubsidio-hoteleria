-- Reversión de 0003. ⚠️ DESTRUYE EL LIBRO, que es el registro de auditoría del
-- inventario. Solo hacia atrás en entorno reproducible, jamás con datos vivos.

DROP TABLE IF EXISTS producto_fantasma;
DROP TABLE IF EXISTS registro_conteo;
DROP TABLE IF EXISTS evidencia_audio;
DROP TABLE IF EXISTS ronda_cierre;
DROP TABLE IF EXISTS ronda;

DROP TYPE IF EXISTS origen_nombre;
DROP TYPE IF EXISTS origen_parse;
DROP TYPE IF EXISTS modo_captura;
DROP TYPE IF EXISTS estado_registro;
