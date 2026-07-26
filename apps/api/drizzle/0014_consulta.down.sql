DROP TABLE IF EXISTS consumo_voz;

-- El rol solo se quita si nadie lo tiene: borrar un rol en uso dejaría
-- usuarios sin rol, que es peor que dejar una fila de más.
DELETE FROM rol WHERE id = 'supervisor'
  AND NOT EXISTS (SELECT 1 FROM usuario WHERE rol_id = 'supervisor');
