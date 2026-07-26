-- 0016 · El MES como unidad de trabajo, y el dinero como consecuencia.
--
-- Hasta aquí el sistema sabía consolidar UN inventario. El cliente hace uno
-- cada mes, en 48 bodegas, y quiere comparar diciembre contra enero. Faltaban
-- tres cosas para eso, y ninguna era un gráfico.
--
--   1. `cierre_inventario` tenía `bodega_id` como clave primaria: una bodega
--      solo se podía cerrar UNA VEZ en la vida del sistema. El segundo cierre
--      —o sea, el mes siguiente— devolvía INVENTARIO_YA_CERRADO para siempre.
--      Nadie lo había visto porque nadie había cerrado dos veces.
--
--   2. `articulo_consolidado` es una proyección VIVA: se recalcula entera cada
--      vez que cierra una ronda. Mirarla el 3 de febrero no dice qué se avaló
--      el 31 de enero, dice qué se concluiría hoy. Para comparar meses hace
--      falta una FOTO, y una foto no se recalcula: se toma una vez.
--
--   3. Sin costo unitario no hay "valor del ajuste contable". El archivo del
--      cliente (`bodegas-y-stock.xlsx`) trae cantidad, unidad y código — NO
--      trae precio. Así que aquí queda la estructura, vacía y honesta: el
--      dashboard informa cuántas referencias tienen costo cargado y cuántas
--      no, en vez de sumar ceros y llamarlo un total.

-- ---------------------------------------------------------------------------
-- 1 · Un cierre por bodega Y PERIODO
-- ---------------------------------------------------------------------------

ALTER TABLE cierre_inventario ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE cierre_inventario ADD COLUMN periodo date;

-- El periodo se calcula en hora de Colombia, no en UTC.
--
-- Un cierre del 31 de enero a las 20:00 en Bogotá es el 1 de febrero a las
-- 01:00 UTC. Truncar en UTC lo archivaría en febrero y dejaría enero sin
-- cierre: el inventario aparecería en el mes equivocado justo en los cierres
-- de fin de mes, que son todos.
UPDATE cierre_inventario
   SET periodo = date_trunc('month', cerrado_en AT TIME ZONE 'America/Bogota')::date
 WHERE periodo IS NULL;

ALTER TABLE cierre_inventario ALTER COLUMN periodo SET NOT NULL;
ALTER TABLE cierre_inventario DROP CONSTRAINT cierre_inventario_pkey;
ALTER TABLE cierre_inventario ADD CONSTRAINT cierre_inventario_pkey PRIMARY KEY (id);

-- Lo que sí sigue siendo único: dos cierres del MISMO mes en la MISMA bodega.
-- Eso no es el mes siguiente, es un doble clic.
ALTER TABLE cierre_inventario
  ADD CONSTRAINT un_cierre_por_bodega_y_periodo UNIQUE (bodega_id, periodo);

CREATE INDEX cierre_por_periodo ON cierre_inventario (periodo DESC, bodega_id);

-- ---------------------------------------------------------------------------
-- 2 · La foto del consolidado en el instante del aval
-- ---------------------------------------------------------------------------
--
-- Append-only, como todo libro de este sistema. `articulo_consolidado` se puede
-- tirar y regenerar desde los registros; esto NO se regenera nunca, porque su
-- valor es precisamente haber sido escrito en un momento que ya pasó.
--
-- Se desnormalizan nombre, código y unidad a propósito. Si dentro de seis meses
-- alguien renombra un artículo en el catálogo, el informe de enero tiene que
-- seguir diciendo cómo se llamaba en enero.
CREATE TABLE consolidado_historico (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cierre_id        uuid NOT NULL REFERENCES cierre_inventario(id),
  bodega_id        uuid NOT NULL REFERENCES bodega(id),
  periodo          date NOT NULL,

  articulo_id      uuid REFERENCES articulo(id),
  fantasma_id      uuid REFERENCES producto_fantasma(id),

  codigo           text,
  nombre           text NOT NULL,
  unidad           text NOT NULL,

  clasificacion    text NOT NULL,
  motivo           text,

  -- Lo que se avaló, lo que decía el sistema, y la resta.
  cantidad_final   numeric(14,3),
  saldo_sistema    numeric(14,3),
  -- NULL cuando falta alguno de los dos. Un NULL dice "no se puede saber";
  -- un 0 diría "cuadra", que es una afirmación distinta y a veces falsa.
  diferencia       numeric(14,3),

  origen_valor     text,
  codigo_razon_id  text REFERENCES codigo_razon(id),
  rondas_afirmando integer NOT NULL DEFAULT 0,

  -- Congelados: el costo de ESE mes, no el de hoy. Un informe contable que
  -- cambia de cifra cuando alguien actualiza una lista de precios no sirve
  -- para cerrar un mes.
  costo_unitario   numeric(14,2),
  valor_ajuste     numeric(16,2),

  CONSTRAINT historico_sobre_algo
    CHECK (articulo_id IS NOT NULL OR fantasma_id IS NOT NULL)
);

CREATE UNIQUE INDEX historico_articulo_unico
  ON consolidado_historico (cierre_id, articulo_id) WHERE articulo_id IS NOT NULL;
CREATE UNIQUE INDEX historico_fantasma_unico
  ON consolidado_historico (cierre_id, fantasma_id) WHERE fantasma_id IS NOT NULL;

-- Las tres consultas del dashboard: por periodo, por bodega y por artículo a
-- lo largo del tiempo.
CREATE INDEX historico_por_periodo ON consolidado_historico (periodo DESC, bodega_id);
CREATE INDEX historico_por_bodega  ON consolidado_historico (bodega_id, periodo DESC);
CREATE INDEX historico_por_codigo  ON consolidado_historico (codigo, periodo) WHERE codigo IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3 · El costo unitario
-- ---------------------------------------------------------------------------
--
-- ⚠️ NACE VACÍA. El archivo del cliente no trae precios (Principio IX: no se
-- inventan datos de negocio). Se llena desde el ERP o con una carga aparte.
-- Mientras esté vacía, el dashboard muestra el ajuste en UNIDADES y declara
-- que no hay cobertura de costo. Es la diferencia entre "no lo sabemos" y
-- "vale cero pesos".
CREATE TABLE costo_articulo (
  bodega_id      uuid NOT NULL REFERENCES bodega(id),
  articulo_id    uuid NOT NULL REFERENCES articulo(id),
  costo_unitario numeric(14,2) NOT NULL CHECK (costo_unitario >= 0),
  moneda         text NOT NULL DEFAULT 'COP',
  -- De dónde salió: importa para saber a quién reclamarle si está mal.
  fuente         text NOT NULL DEFAULT 'erp',
  vigente_desde  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bodega_id, articulo_id)
);

GRANT SELECT, INSERT ON consolidado_historico TO app_role;
GRANT SELECT, INSERT, UPDATE ON costo_articulo TO app_role;

-- La misma regla de 0004: la foto no se retoca.
REVOKE UPDATE, DELETE ON consolidado_historico FROM app_role;
