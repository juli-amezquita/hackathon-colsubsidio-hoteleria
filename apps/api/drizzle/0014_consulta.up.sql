-- 0014 · Modo consulta del supervisor (D-10, Historia extra).
--
-- Dos cosas que no existían: el rol y el contador de minutos.

-- El Supervisor lee y NADA más.
--
-- Podría haberse reutilizado `administrador`, y sería un error: el
-- Administrador cambia tolerancias y envía al ERP. Un supervisor de operación
-- que solo quiere preguntar cómo va el inventario no tiene por qué poder hacer
-- ninguna de las dos, y el día que alguien le dé la credencial a un tercero,
-- la diferencia entre los dos roles es lo único que separa "vio datos" de
-- "cambió el inventario".
INSERT INTO rol (id, nombre) VALUES ('supervisor', 'Supervisor')
ON CONFLICT (id) DO NOTHING;

-- El agente de voz conversacional cuesta por minuto (~$0,05 según el brief,
-- SIN VERIFICAR). A volumen de operario sería inviable; por eso está acotado a
-- supervisores y por eso el gasto se mide.
--
-- Se guarda por mes y por usuario, en segundos: acumular en minutos obligaría a
-- redondear cada sesión y el error se acumularía a favor de nadie.
CREATE TABLE consumo_voz (
  usuario_id uuid NOT NULL REFERENCES usuario(id),
  periodo    text NOT NULL,  -- 'AAAA-MM'
  segundos   integer NOT NULL DEFAULT 0 CHECK (segundos >= 0),
  sesiones   integer NOT NULL DEFAULT 0 CHECK (sesiones >= 0),
  PRIMARY KEY (usuario_id, periodo)
);

GRANT SELECT, INSERT, UPDATE ON consumo_voz TO app_role;
