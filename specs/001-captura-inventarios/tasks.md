# Tareas de Implementación

**Feature**: `001-captura-inventarios` · **Deriva de**: [plan.md](./plan.md) · [data-model.md](./data-model.md) · [contracts/](./contracts/)

Orden: **1 Setup → 2 Fundamentos bloqueantes → 3 Vertical slices por historia.**

`[P]` = paralelizable con las tareas de su mismo bloque. Cada slice de la Fase 3 es **demostrable por sí solo**: al terminarlo hay algo que se le puede enseñar a alguien.

## Propiedad de cada tarea

> **Este repositorio construye el backend y su infraestructura. El frontend lo desarrolla otro integrante del equipo** (`plan.md` §6.1). La frontera entre ambos es el contrato OpenAPI.

| Marca | Quién |
|---|---|
| 🟦 | **Nuestro** — backend, datos, infraestructura |
| 🟨 | **Frontend** — se entrega como requisito al compañero, con su criterio de aceptación |
| 🟪 | **Compartida** — hay una mitad de cada lado y ninguna sirve sola |

Estado: ✅ hecho · 🔄 en curso · ⬜ pendiente · ⛔ bloqueado

---

## Fase 1 · Setup — ✅ COMPLETA (2026-07-25)

Deja el repositorio en condiciones de trabajar. Nada de negocio todavía.

| # | | Tarea | Estado |
|---|---|---|---|
| S-01 | 🟦 | Monorepo pnpm: `apps/api`, `packages/contracts` | ✅ |
| S-02 | 🟦 | TypeScript `strict` + `noUncheckedIndexedAccess`; ESLint con `no-explicit-any` **como error** | ✅ `typecheck` y `lint` en verde |
| S-03 | 🟦 | `docker-compose` con Postgres 17 (+`pg_trgm`) y Redis 7 | ✅ escrito · ⬜ sin levantar (falta arrancar Docker) |
| S-04 | 🟦 | Esqueleto NestJS sobre Fastify con los seis módulos vacíos | ✅ `GET /salud` responde y cumple contrato |
| S-05 | 🟨 | Esqueleto Vite + React + PWA | **Reasignado al compañero.** Sale de este repositorio |
| S-06 | 🟦 | Drizzle + `db:migrate`, `db:rollback`, `db:reset`, `db:verificar` | ✅ escrito · ⬜ ida y vuelta sin probar contra base real |
| S-07 | 🟦 | Vitest y Supertest cableados; k6 con escenario base | ✅ (Playwright se va con el frontend) |
| S-08 | 🟦 | CI: typecheck · lint · test · migración ida-y-vuelta · `terraform fmt`+`validate` | ✅ dos jobs |
| S-09 | 🟦 | Regla de lint que prohíbe importar entre dominios (Principio III) | ✅ **verificado**: un import cruzado rompe el build |
| S-10 | 🟦 | OpenTelemetry con latencia por etapa (D-23) | ✅ |
| S-11 | 🟦 | **Terraform**: VPC, EC2, RDS, ElastiCache, ECR, S3, SSM, IAM (D-25) | ✅ `terraform validate` pasa |
| S-12 | 🟦 | Política de IAM del usuario que ejecuta Terraform | ✅ cuenta `292210043817` |

**Falta para cerrar la fase:** levantar Docker y correr `pnpm db:verificar` (S-03 y S-06).

---

## Fase 2 · Fundamentos bloqueantes — ✅ COMPLETA (2026-07-25)

Todo lo que **más de una historia** necesita. Nada de la Fase 3 empieza sin esto.

### 2.1 Datos e inmutabilidad

| # | | Tarea | Notas |
|---|---|---|---|
| F-01 | 🟦 | Migraciones 0002–0003: tablas de referencia y libro de captura | Cada una con su `down` probado |
| F-02 | 🟦 | Migración 0004: **revocar `UPDATE`/`DELETE`** sobre el libro | La inmutabilidad vive en el motor, no en el código |
| F-03 | 🟦 | Migración 0005: vista `registro_vigente` (DISTINCT ON por secuencia) e índices | Sin columna `superseded_por`: eso exigiría un `UPDATE` |
| F-04 | 🟦 | Migraciones 0006–0010: outbox, proyecciones, auditoría, merma, integración | |
| F-05 | 🟦 | Semillas reproducibles y `db:reset` | Base de todos los escenarios del quickstart |
| F-06 | 🟦 | **Test E7**: `UPDATE`/`DELETE` sobre el libro deben fallar | Bloqueante: sin esto D2 no está garantizada |

### 2.2 Contratos y plataforma

| # | | Tarea | Notas |
|---|---|---|---|
| F-07 | 🟦 | `packages/contracts` con los esquemas Zod de `openapi.yaml` | **Solo esquemas.** Cero reglas de negocio (Principio III) |
| F-08 `[P]` | 🟦 | Generación `contracts:generate` (Zod → OpenAPI) + verificación de deriva en CI | El yaml nunca se edita a mano |
| F-09 | 🟦 | Validación Zod en toda frontera de entrada de la API | Principio VI |
| F-10 | 🟦 | `EventBus` tras interfaz + tabla outbox + despachador pg-boss | Escritura en la **misma transacción** que la causa |
| F-11 | 🟦 | Idempotencia de consumidores por `(consumidor, eventId)` | |
| F-12 | 🟦 | **Test**: si el consumidor falla, el evento sobrevive; si llega dos veces, un solo efecto | Bloqueante para el Principio IV |

### 2.3 Identidad y seguridad

| # | | Tarea | Notas |
|---|---|---|---|
| F-13 | 🟦 | `ProveedorDeIdentidad` como interfaz + implementación con padrón propio y argon2id | D3 |
| F-14 | 🟦 | Sesión en cookie `httpOnly`+`Secure`+`SameSite=Strict`, **sin estado en servidor** | Habilita el despliegue stateless |
| F-15 | 🟦 | Autorización por endpoint y por rol, **negada por defecto** | El cliente recibe el rol para pintar, nunca para permitir |
| F-16 `[P]` | 🟦 | CSP estricta, cabeceras de seguridad, CORS cerrado, límite de tasa | OWASP A01/A05 |
| F-17 `[P]` | 🟦 | Redacción de logs: prohibido audio, credenciales y datos personales | NFR-005, Ley 1581 |

### 2.4 Durabilidad en el cliente

| # | | Tarea | Notas |
|---|---|---|---|
| F-18 | 🟨 | Dexie como *write-ahead log*: escribir → confirmar → encolar | ✅ requisito entregado en [entrega-frontend.md](./entrega-frontend.md) |
| F-19 | 🟪 | Clave de idempotencia UUIDv7 en cliente + `ON CONFLICT DO NOTHING` en servidor | ✅ servidor hecho y probado con 10 reintentos simultáneos |
| F-20 | 🟪 | **Doble sello de tiempo**: `capturado_en` anclado a referencia del servidor + `recibido_en` autoritativo + `desfase_reloj_ms` | ✅ servidor hecho: `GET /tiempo` + dos columnas + desfase con signo |
| F-21 | 🟨 | Service Worker (Workbox): app shell y **catálogo de la bodega** en caché — habilita la resolución local del nombre sin red. **El saldo esperado jamás se cachea** | ✅ requisito entregado al frontend |
| F-21b | 🟨 | Resolución de nombre **en el dispositivo** sobre el catálogo cacheado, con los mismos dos umbrales que el servidor | ✅ requisito entregado, con los dos umbrales especificados |
| F-22 | 🟨 | Distinción visual inequívoca entre *guardado* y *validado* | ✅ requisito entregado, con los cuatro estados |

### 2.5 Voz — ✅ COMPLETA

| # | | Tarea | Notas |
|---|---|---|---|
| F-23 | 🟪 | `ProveedorDeVoz` como interfaz + adaptador Deepgram Flux + **adaptador simulado** | ✅ servidor hecho; el simulado permite trabajar sin credenciales ni costo |
| F-24 | 🟪 | ⚠️ **Resolver D-07** y aplicar: endpoint de token efímero (opción A) o sesión de audio en servidor (opción B) | ✅ **D-07 cerrada en A**: `POST /voz/token/:rondaId` emite credencial efímera de 60 s |
| F-25 | 🟨 | Transporte WebRTC + Silero VAD con carga diferida y *push-to-talk* como camino alterno | ⬜ frontend — requisito por entregar |
| F-26 | 🟪 | **Gramática PEG**: separa `<nombre> <cantidad> <unidad>`; números en español, decimales, unidades con sinónimos, rechazo de fraccionarios verbales, y doble segmentación cuando el nombre lleva número dentro ("aceite 3 litros") | ✅ paquete `@cci/gramatica`, 32 pruebas, corre en dispositivo y servidor |
| F-27 | 🟪 | Métrica de cobertura de la gramática, por turno | ✅ `cubierto()` en la gramática; el nombre con cantidad no cuenta como cubierto |
| F-28 | 🟦 | `ProveedorDeInterpretacion` (`claude-opus-5` vía OpenRouter) con **split estático/dinámico y TTL 1 h** | ✅ `claude-opus-5`, split estático/dinámico, TTL 1 h, `leidosDeCache` como métrica |
| F-29 | 🟦 | La salida del modelo **vuelve** a la validación determinista antes de guardarse | ✅ probado: un artículo inventado se rechaza |
| F-30 `[P]` | 🟨 | Readback con `speechSynthesis` + confirmación visual siempre en paralelo | ✅ requisito entregado, con readback dígito a dígito |

### 2.6 Caché y rendimiento — ✅ COMPLETA

| # | | Tarea | Notas |
|---|---|---|---|
| F-31 | 🟦 | Redis para catálogo, saldos y tolerancias vigentes | ✅ degrada a Postgres si Redis cae; el saldo se cachea en servidor y NUNCA se sirve |
| F-32 `[P]` | 🟦 | Presupuesto por etapa instrumentado y verificado en CI | ✅ 6 pruebas; detecta ciclo desbordado aunque cada etapa quepa |
| F-33 `[P]` | 🟦 | k6 con 500 concurrentes; falla la build por encima de p95 200 ms | ✅ `tests/perf/conteo.js` en CI con `abortOnFail` |

---

## Fase 3 · Vertical slices por historia

Cada slice atraviesa datos → dominio → API → UI → pruebas, y termina en algo demostrable.

### Slice 1 — Conteo ciego en ronda propia (P1)

| # | Tarea | Estado |
|---|---|---|
| H1-01 | Dominio `captura`: abrir ronda, registrar conteo con secuencia monótona, cerrar ronda | ✅ abrir/registrar/cerrar con secuencia monótona |
| H1-02 | Dominio `catalogo`: **resolución del nombre dictado** por `pg_trgm` + alias, con umbral de aceptación y umbral de margen (FR-1.27). Devuelve artículo resuelto o lista de candidatos. **Sin saldo esperado en la respuesta** | ✅ pg_trgm + alias, dos umbrales |
| H1-02b `[P]` | Tabla `articulo_alias` por bodega + métrica de tasa de desambiguación manual por bodega (señal de D-19) |
| H1-03 | Endpoints `POST /rondas`, `POST /resolucion-articulo`, `POST /registros`, `GET /cuadre-cierre`, `POST /cierre` | ✅ 5 endpoints en producción |
| H1-04 | Corrección dentro de la ronda: exige `confirmaCorreccion`, **no suma**, conserva ambos (D4) | ✅ corrección conserva ambos y NO suma |
| H1-05 | Cuadre de cierre: cada artículo no registrado exige *contado en cero* o *no contado* (D1) | ✅ cuadre: contado en cero vs no contado |
| H1-06 | UI de dictado libre: agente de voz continuo, artículo resuelto en pantalla, **selector de candidatos por toque** cuando el nombre no resuelve, alternativa por texto con verificación explícita | ⏳ del compañero (UI de dictado) |
| H1-06b | Persistir `saldo_esperado_congelado` y `origen_nombre` en cada registro (D8, FR-1.26) | ✅ saldo congelado + origen_nombre en cada fila |
| H1-07 `[P]` | Accesibilidad de la ruta de conteo: una mano, contraste, lector de pantalla |
| H1-08 | **Test E2**: el saldo esperado no es obtenible desde el dispositivo por ningún medio | ✅ E2: recorre cada respuesta valor por valor |
| H1-09 | Test E1 extremo a extremo | ✅ E1: 16 pruebas e2e |

**Demostrable**: un operario cuenta 20 artículos por voz y cierra su ronda. El papel ya sobra.

### Slice 2 — Validaciones y discrepancia (P2)

| # | Tarea | Estado |
|---|---|---|
| H2-01 | Validación de unidad esperada; alerta indicando la correcta | ✅ unidad esperada; alerta con la correcta |
| H2-02 | Comparación contra saldo con tolerancia de merma; **el límite exacto está dentro** de tolerancia | ✅ tolerancia exacta con BigInt; el límite justo cae dentro |
| H2-03 | Congelar la tolerancia aplicada en el registro (FR-8.2: sin revaluación retroactiva) | ✅ tolerancia y veredicto congelados en la fila |
| H2-04 | Alerta que **no permite deducir** saldo ni magnitud de la diferencia | ✅ sin dirección + verificaciones agotadas: la alerta no es oráculo |
| H2-05 | Confirmación pese a alerta → marca de advertencia y evidencia obligatoria | ✅ advertido + evidencia diferida por endpoint propio |
| H2-06 | Bloqueo del cierre de ronda con alertas sin resolver | ✅ vista `pendiente_de_resolver`: la misma regla avisa y bloquea |
| H2-07 | `contado_en_cero` valida como cantidad; `no_contado` no genera discrepancia | ✅ contado_en_cero valida; no_contado no |
| H2-08 | Test E3 | ✅ E3: 13 pruebas e2e + 18 unitarias de la regla |

**Demostrable**: el sistema atrapa un error de unidad y uno de cantidad mientras el operario sigue frente al estante.

### Slice 3 — Consolidación contra el saldo esperado (P3)

| # | Tarea | Estado |
|---|---|---|
| H3-01 | Dominio `consolidacion` como consumidor de `RondaCerrada` | ✅ consumidor real de `RondaCerrada`; el despachador ya arranca con la app |
| H3-02 | Regla D5: conciliado ⟺ el conteo ciego coincide con el saldo esperado dentro de tolerancia. **Una ronda basta** | ✅ una ronda basta; probado con una y con dos |
| H3-03 | Clasificación de auditables: discrepancia · contradicción entre rondas · sin cobertura · sin saldo esperado · fantasma | ✅ los 4 motivos de artículo + precedencia documentada |
| H3-04 | Restricción de base `conciliado_exige_conteo_afirmado` + `valor_final_con_origen` | ✅ ya en 0007; ahora con código que las respeta |
| H3-05 | Proyección `articulo_consolidado` + comando de reconstrucción desde el libro | ✅ `pnpm reconstruir`; prueba que borra la proyección y la regenera igual |
| H3-06 | Bloqueo del cierre de inventario sin **al menos una** ronda cerrada | ✅ `verificarCierrePosible`: sin ronda cerrada no hay cierre |
| H3-07 | Regla conservadora (FR-3.10): si **cualquier** ronda produjo diferencia, el artículo es auditable | ✅ una ronda discrepante arrastra a las que coincidieron |
| H3-08 | Test E4: una ronda que concilia · discrepancia · dos rondas que se contradicen · `no_contado` como ausencia de afirmación | ✅ E4: 17 pruebas e2e + 19 unitarias de la regla |

**Demostrable**: un operario cuenta la bodega y el sistema dice exactamente qué quedó resuelto y qué necesita al Auditor. Con un segundo operario, lo acumula sin pisar nada.

### Slice 4 — Reconteo del Auditor (P4)

| # | Tarea | Estado |
|---|---|---|
| H4-01 | Bandeja del Auditor: exclusivamente lo auditable | ✅ bandeja con `resuelto`; pendientes aparte |
| H4-02 | Detalle por ronda con autor y cantidad; diferencia contra sistema **solo** para el Auditor | ✅ saldo y diferencia por ronda, solo rol Auditor (403 al Operador) |
| H4-03 | Reconteo por voz o texto, append-only | ✅ append-only con idempotencia; voz o texto |
| H4-04 | Código de razón de catálogo controlado, obligatorio para cerrar (R4) | ✅ catálogo controlado; razón inventada → 400 |
| H4-05 | **Árbitro** (`claude-opus-5`): ordena la evidencia del caso. **No decide** quién tiene razón | ✅ árbitro con `claude-opus-5` + respaldo determinista; sin campo de veredicto |
| H4-06 | Señalar en la traza cuando el Auditor auditó una ronda propia | ✅ `conflicto_independencia` calculado y persistido |
| H4-07 | Bloqueo del cierre con auditables pendientes | ✅ `AUDITABLES_PENDIENTES` bloquea el cierre |
| H4-08 | Test E5 | ✅ E5: 18 pruebas e2e |

**Demostrable**: el Auditor resuelve 8 ítems en vez de recorrer 800, con la evidencia ya ordenada.

### Slice 5 — Productos fantasma (P5)

| # | Tarea |
|---|---|
| H5-01 | Registro con descripción detallada (criterios objetivos de rechazo) y unidad observada |
| H5-02 | Sin validación de discrepancia: no hay saldo contra el cual comparar |
| H5-03 | Escalado **siempre** a auditable, sin fusionar hallazgos de rondas distintas |
| H5-04 | Búsqueda `pg_trgm` para confirmar que no existía en catálogo |
| H5-05 | Test de la historia 5 |

### Slice 6 — Continuidad ante pérdida de red (P6)

| # | Tarea |
|---|---|
| H6-01 | Cola de sincronización con reintento y backoff |
| H6-02 | Reanudación en el ítem siguiente al último grabado |
| H6-03 | Historial visible de los últimos 3–5 registros exitosos |
| H6-04 | Alertas diferidas notificadas y exigidas antes del cierre (FR-6.7) |
| H6-05 | Aviso y bloqueo si el almacenamiento local se agota (FR-6.6) |
| H6-06 | Test E6: diez cortes, cero pérdidas, cero duplicados |
| H6-07 | Test E8: degradación de proveedores |

### Slice 7 — Salida e integración (P7)

| # | Tarea |
|---|---|
| H7-01 | Exportación CSV y XLSX **en servidor** (Principio I) |
| H7-02 | Consolidado con valor final, origen y código de razón por artículo |
| H7-03 | `PuertoInventarioERP` + adaptador simulado + adaptador Oracle Fusion |
| H7-04 | Idempotencia del envío por referencia única |
| H7-05 | Constancia auditable de qué salió, cuándo y por quién |
| H7-06 | Bloqueo de exportación definitiva con auditables pendientes |

### Slice 8 — Administración de mermas (P8)

| # | Tarea |
|---|---|
| H8-01 | Panel exclusivo del Administrador |
| H8-02 | Historial de cambios con autor y momento |
| H8-03 | Validación de valores; cero es válido |
| H8-04 | Invalidación de la caché de tolerancias en Redis |

### Slice 9 — Modo consulta del supervisor (extra)

| # | Tarea |
|---|---|
| H9-01 | Grok Voice Agent, **solo lectura**, restringido a Supervisor/Administrador |
| H9-02 | Límite de minutos por mes y alerta de consumo |
| H9-03 | Verificar endpoint y tarifa reales antes de habilitarlo |

---

## Fase 4 · Cierre

| # | Tarea |
|---|---|
| C-01 | Suite completa `pnpm verify` en verde |
| C-02 | E9 rendimiento: 500 concurrentes, p95 API < 200 ms, ciclo < 1.500 ms, carga < 3 s en 4G |
| C-03 | E10 accesibilidad automática **+ recorrido manual** con lector de pantalla y una sola mano |
| C-04 | E11 seguridad: Semgrep, `npm audit`, ZAP baseline |
| C-05 | **Prueba en bodega real**: ruido, guantes, red intermitente |
| C-06 | Medir cobertura de gramática en producción; ampliarla si < 85% |
| C-07 | Verificar tarifas reales de STT y del agente de voz; ajustar el modelo de costos |
| C-08 | Registrar en `spec.md` lo aprendido que contradiga un supuesto (Principio IX) |

---

## Ruta crítica — 🟦 nuestra, no depende del frontend

```
S-01 ✅ → S-06 ✅ → F-01 → F-02 → F-03 → F-07 → F-09 → F-10 → F-13 → F-14 → H1-01 → H1-03 → H1-08
```

Nada de esta cadena espera al compañero. La integración ocurre en `H1-03`, cuando los endpoints existen y el contrato queda publicado.

La ruta original pasaba por `F-18`, `F-20` y `F-26`. Con el reparto, `F-18` es enteramente del frontend y de `F-20` y `F-26` solo nos toca la mitad del servidor, así que salen del camino crítico.

**D-07 quedó cerrada en la opción A** (2026-07-25). `F-24` deja de estar bloqueada: lo que hay que construir es el endpoint que emite el token efímero.

## Paralelización

Cuatro frentes:

- 🟦 **Datos y dominio** — la ruta crítica. Slices 1 → 2 → 3 → 4, con dependencia estricta.
- 🟦 **Plataforma** — identidad, seguridad, rendimiento y observabilidad. Transversal, arranca en paralelo desde la Fase 2.
- 🟦 **Infraestructura** — Terraform ya está escrito; se aplica cuando haya algo que desplegar, no antes (cada día de RDS y ElastiCache encendidos se paga).
- 🟨 **Frontend** — el compañero, contra el contrato OpenAPI. Su primer bloqueo real es que exista `H1-03`.

Los slices 5 a 8 solo dependen del slice al que se enganchan, no entre sí.

## Lo que hay que exigirle al frontend

No basta con entregarle el contrato. Tres cosas no se ven en OpenAPI y, si nadie las pide, no aparecen:

1. **`F-18` · durabilidad antes que red.** Escribir en IndexedDB *antes* de intentar el envío, y confirmarle al operario solo cuando el dato ya es durable localmente. Es la Restricción 2 y es lo que evita perder un conteo por un microcorte.
2. **`F-21b` · resolver el nombre sin red**, contra el catálogo cacheado. Sin esto, un corte de Wi-Fi impide contar aunque el registro sí se guarde.
3. **La mitad cliente de `E2`.** Que el saldo esperado no aparezca en el almacenamiento local tras una sesión completa. La mitad servidor es nuestra; esta no la cubre nadie por accidente.
