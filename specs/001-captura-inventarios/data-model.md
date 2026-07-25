# Modelo de Datos y Migraciones

**Feature**: `001-captura-inventarios` · **Motor**: PostgreSQL 17 · **Acceso**: Drizzle ORM
**Deriva de**: [spec.md](./spec.md) D1–D6 · [research.md](./research.md) D-13 a D-16

---

## 1. El principio que organiza todo: libro contra proyección

D2 exige que nada se actualice en sitio. Aplicado sin criterio, eso vuelve imposible algo tan normal como marcar una discrepancia como resuelta. La salida es separar el esquema en dos clases con reglas distintas:

| | **Libro** (append-only) | **Proyección** (reconstruible) |
|---|---|---|
| Qué contiene | Lo que ocurrió: conteos, reconteos, hallazgos, cierres | Lo que se concluye: estado consolidado, discrepancias abiertas |
| Mutabilidad | **Solo `INSERT`.** `UPDATE`/`DELETE` revocados en el motor | `INSERT`/`UPDATE` permitidos |
| Si se pierde | Catástrofe irrecuperable | Se reconstruye del libro |
| Autoridad | Fuente de verdad | Derivada, nunca fuente |

Toda proyección **debe** poder reconstruirse desde el libro con un comando. Esa es la prueba de que el libro es realmente la fuente de verdad y no un archivo paralelo que alguien dejó de mantener.

Hay una **tercera clase**, la *referencia*, que es la **tabla madre** de D8: `articulo` y `saldo_esperado`, lo que el sistema central dice que hay. Para el flujo de conteo es **solo de lectura**. Un conteo no la modifica: crea una fila en el libro que **hereda** su número (`saldo_esperado_congelado`) y le pone al lado el número contado. Los dos viven juntos en el mismo registro, de modo que "qué decía el sistema y qué encontró la gente" se responde leyendo una fila, sin reconstruir nada y sin depender de que la madre no haya cambiado entretanto. La madre solo se actualiza con el aval del Auditor (FR-7.9).

### 1.1 Cómo se supersede sin actualizar

Un registro corregido no se marca: se **añade** otro con mayor número de secuencia. El vigente es el de secuencia máxima por `(ronda, artículo)`.

Esto importa porque el diseño intuitivo —una columna `superseded_por` que se rellena al corregir— **requiere un `UPDATE`** y contradice la propia regla que pretende implementar. Con secuencia monótona no hay ninguna escritura sobre una fila existente, jamás.

```sql
CREATE VIEW registro_vigente AS
SELECT DISTINCT ON (ronda_id, articulo_id) *
FROM registro_conteo
ORDER BY ronda_id, articulo_id, secuencia DESC;
```

---

## 2. Entidades

### 2.1 Libro — append-only

**`ronda`** — el recorrido de una persona sobre una bodega (D2).

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | UUIDv7 |
| `bodega_id` | `uuid` FK | |
| `operador_id` | `uuid` FK | |
| `abierta_en` | `timestamptz` | sello de servidor |
| `desfase_reloj_ms` | `integer` | medido al abrir (D-16) |

*El cierre de ronda no es un `UPDATE`: es una fila en `ronda_cierre`.*

**`ronda_cierre`** — `ronda_id` PK/FK · `cerrada_en` · `cerrada_por`. Su existencia **es** el estado cerrado.

**`registro_conteo`** — lo que una persona registró de un artículo (D2, FR-1.10, FR-1.13).

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | |
| `ronda_id` | `uuid` FK | |
| `articulo_id` | `uuid` FK | |
| `secuencia` | `integer` | monótono por ronda; define el vigente |
| `estado` | `enum` | `contado` \| `contado_en_cero` \| `no_contado` (FR-1.16) |
| `cantidad` | `numeric(14,3)` | `NULL` solo si `no_contado` |
| `unidad_id` | `uuid` FK | |
| `modo_captura` | `enum` | `voz` \| `texto` (R3) |
| `origen_parse` | `enum` | `gramatica` \| `modelo` \| `manual` — para medir cobertura (D-08) |
| `capturado_en` | `timestamptz` | reloj del cliente anclado (D-16) |
| `recibido_en` | `timestamptz` | **sello autoritativo** del servidor |
| `clave_idempotencia` | `uuid` UNIQUE | generada en el dispositivo (R2) |
| `saldo_esperado_congelado` | `numeric(14,3)` | **el número de la tabla madre** al momento del conteo. Es la mitad "heredada" del registro hijo (D8, FR-1.26). **Nunca se sirve al cliente del Operador** (FR-1.18) |
| `origen_nombre` | `enum` | `exacto` \| `similitud` \| `seleccion_usuario` \| `alias` — cómo se resolvió el artículo dictado (D-05) |
| `tolerancia_aplicada` | `numeric(6,4)` | congelada al momento del conteo (FR-8.2) |
| `advertido` | `boolean` | se confirmó pese a alerta (FR-2.4) |
| `evidencia_audio_id` | `uuid` FK NULL | subida diferida (D-07) |

Restricciones: `UNIQUE (ronda_id, articulo_id, secuencia)` · `CHECK (estado <> 'no_contado' OR cantidad IS NULL)` · `CHECK (cantidad IS NULL OR cantidad >= 0)`.

**`producto_fantasma`** — hallazgo sin catálogo (FR-5.x): `ronda_id`, `descripcion` (con `CHECK (length(trim(descripcion)) >= 20)`), `unidad_observada`, `cantidad`, `clave_idempotencia`, mismos campos de trazabilidad.

**`reconteo`** — registro del Auditor (FR-4.x): `articulo_id` o `producto_fantasma_id`, `auditor_id`, `secuencia`, `cantidad`, `unidad_id`, `codigo_razon_id`, `modo_captura`, sellos y clave de idempotencia. Mismo mecanismo de supersedencia.

**`cierre_inventario`** — `bodega_id`, `cerrado_en`, `cerrado_por`, `hash_consolidado`.

**`outbox`** — `id`, `tipo_evento`, `payload jsonb`, `ocurrido_en`, `despachado_en NULL`. Escrito **en la misma transacción** que su causa (Principio IV).

**`evidencia_audio`** — `id`, `clave_s3`, `subido_en`. Nunca contiene el audio, solo su ubicación.

### 2.2 Referencia — mutable, administrada

`usuario` (con `hash_password` argon2id), `rol`, `bodega`, `unidad_medida` (con `es_peso boolean`), `articulo` (nombre, código opcional, unidad esperada, índice GIN `pg_trgm`), **`articulo_alias`** (`bodega_id`, `articulo_id`, `alias_normalizado` — cómo llama la gente al artículo, que rara vez es como lo llama el ERP; D-19), `saldo_esperado` (bodega × artículo — **nunca sale del servidor**), `codigo_razon` (catálogo controlado, R4), `configuracion_merma` + `configuracion_merma_historial` (FR-8.3/8.5).

**Esta es la "tabla madre" de D8.** `articulo` y `saldo_esperado` son **solo de lectura para el flujo de conteo**: ningún registro de Operador las modifica. Se actualizan únicamente al cerrar el inventario con el aval del Auditor (FR-7.9).

### 2.3 Proyección — reconstruible

**`articulo_consolidado`** — el resultado de aplicar D5 (coincidencia del conteo ciego con el saldo esperado).

| Columna | Notas |
|---|---|
| `bodega_id`, `articulo_id` | PK compuesta |
| `clasificacion` | `conciliado` \| `auditable` (FR-3.2, FR-3.3) |
| `motivo_auditable` | `discrepancia` \| `contradiccion_entre_rondas` \| `sin_cobertura` \| `sin_saldo_esperado` \| `producto_fantasma` |
| `valor_final`, `origen_valor` | `conteo_ciego` \| `auditor` (FR-7.7) |
| `rondas_afirmando` | `integer` — rondas que afirmaron una cantidad. **Informativo**: una sola basta para conciliar (D5) |

**`discrepancia`** — estado (`abierta`/`en_reconteo`/`cerrada`) y código de razón al cerrarse. Se actualiza; se reconstruye del libro si hace falta.

**`evento_procesado`** — `(consumidor, event_id)` PK. Hace idempotentes a los consumidores (Principio IV).

---

## 3. Reglas del motor, no de la aplicación

```sql
-- La inmutabilidad se impone donde no se puede eludir por descuido
REVOKE UPDATE, DELETE ON
  ronda, ronda_cierre, registro_conteo, producto_fantasma,
  reconteo, cierre_inventario, evidencia_audio
FROM app_role;

-- Un artículo no se concilia sin que alguna ronda haya afirmado una cantidad,
-- y un conciliado no puede arrastrar motivo de auditoría (D5, FR-3.2, FR-3.9)
ALTER TABLE articulo_consolidado ADD CONSTRAINT conciliado_exige_conteo_afirmado
  CHECK (clasificacion <> 'conciliado'
         OR (rondas_afirmando >= 1 AND motivo_auditable IS NULL));

-- El valor que sale al ERP siempre tiene origen declarado (FR-7.7)
ALTER TABLE articulo_consolidado ADD CONSTRAINT valor_final_con_origen
  CHECK (valor_final IS NULL OR origen_valor IS NOT NULL);
```

La segunda restricción es la que impide que un error de código publique al ERP una cifra que **ningún** operario afirmó, o que marque como cerrado algo que el motor todavía considera auditable. Es la garantía de D5 escrita donde no se puede eludir por descuido.

---

## 4. Migraciones reversibles

Cada migración es un par `NNNN_nombre.up.sql` / `.down.sql`. **Ninguna se acepta sin su `down` probado**: CI aplica todas hacia adelante, revierte hasta cero y vuelve a aplicar. Una migración que no revierte no entra.

| # | Migración | Reversión |
|---|---|---|
| 0001 | Extensiones (`pg_trgm`, `pgcrypto`) y rol `app_role` | `DROP EXTENSION` / `DROP ROLE` |
| 0002 | Referencia: usuario, rol, bodega, unidad, artículo, saldo | `DROP TABLE` en orden inverso |
| 0003 | Libro de captura: ronda, ronda_cierre, registro_conteo, producto_fantasma | `DROP TABLE` |
| 0004 | Revocación de `UPDATE`/`DELETE` sobre el libro | `GRANT UPDATE, DELETE` |
| 0005 | Vista `registro_vigente` e índices | `DROP VIEW` / `DROP INDEX` |
| 0006 | Outbox y `evento_procesado` | `DROP TABLE` |
| 0007 | Proyección: `articulo_consolidado`, `discrepancia` | `DROP TABLE` |
| 0008 | Auditoría: `codigo_razon`, `reconteo`, `cierre_inventario` | `DROP TABLE` |
| 0009 | Merma: configuración + historial | `DROP TABLE` |
| 0010 | Integración: exportación y envío al ERP | `DROP TABLE` |

**Reglas de reversibilidad** (Restricción 6):

1. **Ninguna migración destruye datos en su `down`** sin decirlo explícitamente en un comentario de cabecera. Revertir 0004 devuelve permisos; no borra filas.
2. **Renombrar es añadir + copiar + eliminar en migraciones separadas**, nunca `ALTER … RENAME` en una sola. Así la reversión de cada paso es trivial y el despliegue tolera versiones mixtas.
3. **Toda columna nueva nace `NULL`** o con `DEFAULT`; volverla obligatoria es una migración posterior, después del respaldo.
4. **Los índices se crean `CONCURRENTLY`** en producción, fuera de transacción.
5. `pnpm db:reset` deja el sistema en un estado inicial conocido y reproducible con datos semilla.

---

## 5. Índices que sostienen los umbrales

| Índice | Sostiene |
|---|---|
| `registro_conteo (ronda_id, articulo_id, secuencia DESC)` | Resolución del vigente — ruta caliente |
| `registro_conteo (clave_idempotencia)` UNIQUE | Deduplicación de reintentos (R2) |
| `articulo` GIN `gin_trgm_ops` sobre nombre normalizado | Búsqueda de catálogo (D-19) |
| `articulo_consolidado (bodega_id, clasificacion)` | Bandeja del Auditor: solo lo auditable (FR-4.1) |
| `articulo_alias (bodega_id, alias_normalizado)` GIN `gin_trgm_ops` | Resolución del nombre dictado — **ruta caliente de cada turno** (D-05, D-19) |
| `outbox (despachado_en) WHERE despachado_en IS NULL` | Despacho de eventos, índice parcial |
| `saldo_esperado (bodega_id, articulo_id)` | Validación en servidor (FR-2.2) |

---

## 6. Retención y datos personales

Se guarda de una persona lo mínimo para atribuir un conteo: identificador, nombre y rol. **No** se guarda audio crudo en base de datos ni en logs (NFR-005); la evidencia vive en S3 con ciclo de vida definido y referencia por ID.

El libro es el registro de auditoría del inventario y se conserva según la política contable de Colsubsidio — **dato pendiente de confirmar con el negocio**, no asumido aquí.
