-- 0010 · Validación contra el saldo esperado (Historia 2).
--
-- Dos ideas sostienen todo lo que sigue.
--
-- La primera: el resultado de validar se CONGELA en la fila, junto a la
-- tolerancia que se le aplicó. No se recalcula al leer. Si mañana el
-- Administrador sube la merma del 2% al 5%, los conteos de ayer siguen
-- diciendo lo que dijeron ayer (FR-8.2). Recalcular al leer sería más simple y
-- volvería la traza inservible: nadie podría explicar por qué el sistema alertó
-- si el motivo de la alerta ya no existe.
--
-- La segunda: la alerta NO se guarda como estado. Una alerta abierta es una
-- propiedad del registro vigente —el de secuencia máxima—, no una fila que
-- alguien tenga que acordarse de cerrar. Así no hay UPDATE, no hay resolución
-- olvidada, y no puede quedar desincronizada de los datos que la causaron.

-- `registro_vigente` se definió con `SELECT *`, que Postgres expande al crear
-- la vista. Sin recrearla NO vería la columna nueva —y `pendiente_de_resolver`,
-- que lee de ella, fallaría—. Además bloquea el DROP COLUMN de más abajo.
DROP VIEW registro_vigente;

CREATE TYPE resultado_validacion AS ENUM (
  'aceptado',
  'alerta_unidad',
  'alerta_discrepancia',
  'no_validable',
  -- El artículo agotó sus verificaciones en esta ronda. Ver el comentario sobre
  -- el oráculo en `validacion.ts`: seguir respondiendo convertiría la alerta en
  -- un buscador binario del saldo esperado.
  'sin_verificacion'
);

ALTER TABLE registro_conteo
  ADD COLUMN resultado_validacion resultado_validacion;

-- Los conteos anteriores a esta migración se marcan `no_validable`, que es
-- literalmente lo que fueron: el sistema no los validó porque todavía no sabía
-- hacerlo. Inventarles un 'aceptado' retroactivo diría que pasaron una
-- verificación que nunca existió, y el libro es un registro de auditoría.
UPDATE registro_conteo
   SET resultado_validacion = 'no_validable'
 WHERE resultado_validacion IS NULL AND estado <> 'no_contado' AND NOT advertido;

-- Salvo los que ya venían marcados como advertidos. Ahí no se inventa nada: en
-- el código anterior `advertido` significaba literalmente "el usuario confirmó
-- pese a una alerta", así que la marca ES la constancia de que hubo alerta,
-- aunque el veredicto no se guardara todavía.
UPDATE registro_conteo
   SET resultado_validacion = 'alerta_discrepancia'
 WHERE resultado_validacion IS NULL AND advertido;

-- Todo conteo que afirma algo tiene veredicto. `no_contado` no afirma nada, y
-- por eso es el único que puede no tenerlo (FR-2.7).
ALTER TABLE registro_conteo
  ADD CONSTRAINT afirmacion_exige_veredicto
  CHECK (estado = 'no_contado' OR resultado_validacion IS NOT NULL);

-- Una advertencia sin alerta que la justifique sería una marca sin causa.
ALTER TABLE registro_conteo
  ADD CONSTRAINT advertido_exige_alerta
  CHECK (NOT advertido
         OR resultado_validacion IN ('alerta_unidad', 'alerta_discrepancia'));

-- ---------------------------------------------------------------------------
-- Evidencia de una confirmación pese a alerta (FR-2.4)
-- ---------------------------------------------------------------------------
--
-- La evidencia llega DESPUÉS del conteo: la subida es diferida (D-07), y el
-- registro ya se confirmó al operario. Rellenar `registro_conteo` cuando el
-- audio aterrice exigiría un UPDATE sobre una tabla con UPDATE revocado — y
-- revocarlo fue deliberado.
--
-- Por eso el vínculo es una fila nueva. Se adjunta, no se modifica.
CREATE TABLE evidencia_registro (
  registro_id  uuid PRIMARY KEY REFERENCES registro_conteo(id),
  evidencia_id uuid NOT NULL REFERENCES evidencia_audio(id),
  adjuntada_en timestamptz NOT NULL DEFAULT now()
);

-- La columna que este diseño reemplaza. Nunca se usó: llenarla habría exigido
-- el UPDATE que la tabla no admite.
ALTER TABLE registro_conteo DROP COLUMN evidencia_audio_id;

GRANT SELECT, INSERT ON evidencia_registro TO app_role;
REVOKE UPDATE, DELETE ON evidencia_registro FROM app_role;

-- Se recrea con la forma nueva de la tabla.
CREATE VIEW registro_vigente AS
SELECT DISTINCT ON (ronda_id, articulo_id) *
FROM registro_conteo
ORDER BY ronda_id, articulo_id, secuencia DESC;

GRANT SELECT ON registro_vigente TO app_role;

-- ---------------------------------------------------------------------------
-- Lo que bloquea el cierre de una ronda (FR-2.8)
-- ---------------------------------------------------------------------------
--
-- Se expone como vista para que la condición viva en UN solo sitio: la usan el
-- cuadre de cierre —que la muestra— y el cierre —que la impone—. Dos consultas
-- equivalentes escritas por separado divergen tarde o temprano, y divergirían
-- justo en el punto donde una deja pasar lo que la otra bloquea.
-- Sobre `modo_captura = 'voz'` en la segunda condición: solo se puede exigir la
-- evidencia que puede existir. Un conteo dictado tiene audio que adjuntar; una
-- decisión tomada en la pantalla del cuadre de cierre no tiene ninguno, y
-- pedírselo dejaría la ronda imposible de cerrar para siempre.
CREATE VIEW pendiente_de_resolver AS
SELECT v.ronda_id,
       v.id AS registro_id,
       v.articulo_id,
       v.resultado_validacion,
       v.advertido,
       CASE
         WHEN v.resultado_validacion IN ('alerta_unidad', 'alerta_discrepancia')
              AND NOT v.advertido                          THEN 'alerta_sin_responder'
         ELSE                                                   'evidencia_faltante'
       END AS motivo
FROM registro_vigente v
LEFT JOIN evidencia_registro e ON e.registro_id = v.id
WHERE (v.resultado_validacion IN ('alerta_unidad', 'alerta_discrepancia') AND NOT v.advertido)
   OR (v.advertido AND v.modo_captura = 'voz' AND e.registro_id IS NULL);

GRANT SELECT ON pendiente_de_resolver TO app_role;
