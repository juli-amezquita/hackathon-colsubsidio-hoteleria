-- 0004 · La inmutabilidad vive en el MOTOR, no en el código.
--
-- Esta es la migración más importante del proyecto.
--
-- D2 exige que nada se actualice en sitio. Confiar eso a la capa de aplicación
-- significa que un UPDATE por descuido pasa la revisión de código y falla en
-- producción, años después, cuando alguien note que un conteo cambió y no haya
-- forma de saber cuál era el original.
--
-- Revocando el permiso en el motor, ese UPDATE falla en el acto, en la primera
-- prueba, contra el rol real de la aplicación. La garantía deja de depender de
-- la disciplina de quien escribe el código.
--
-- Lo verifica el test E7 (F-06), que es bloqueante.

REVOKE UPDATE, DELETE ON
  ronda,
  ronda_cierre,
  registro_conteo,
  producto_fantasma,
  evidencia_audio
FROM app_role;

-- Que no se recupere por un GRANT posterior a nivel de esquema.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE UPDATE, DELETE ON TABLES FROM app_role;
