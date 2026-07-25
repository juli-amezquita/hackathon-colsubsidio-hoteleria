-- Reversión de 0009. ⚠️ Descarta las constancias de salida.

DROP INDEX IF EXISTS salida_por_bodega;
DROP TABLE IF EXISTS constancia_salida;

DROP TYPE IF EXISTS estado_envio;
DROP TYPE IF EXISTS destino_salida;
