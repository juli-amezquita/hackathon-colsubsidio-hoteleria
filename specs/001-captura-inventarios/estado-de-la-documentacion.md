# Estado de la documentación

**Fecha de la revisión**: 2026-07-26 · **Rama**: `integracion` · **Último commit revisado**: `ad899bb`

Los documentos de este directorio se escribieron **antes** que buena parte del código. Este archivo dice, documento por documento, qué sigue siendo cierto y qué no. No es una lista de tareas: es un mapa para que quien lea la documentación sepa dónde puede confiar en ella.

Tres etiquetas:

- **AL DÍA** — describe el sistema tal como está.
- **DESFASADO** — describe el sistema **actual** y se equivoca. Hay que corregirlo.
- **HISTÓRICO** — era correcto cuando se escribió y su valor es precisamente ese. Un documento de investigación fechado no está «mal» por ser viejo. No hay que tocarlo.

La distinción importa: `research.md` cuenta **por qué se decidió** algo en su momento; `data-model.md` afirma **cómo es** el esquema hoy. El primero envejece bien; el segundo, no.

---

## Resumen

| Documento | Estado |
|---|---|
| `SPEC.md` (raíz) | **HISTÓRICO** — es el encargo del cliente, no se toca |
| `.specify/memory/constitution.md` | **AL DÍA** con dos desviaciones registradas abajo |
| `spec.md` | **DESFASADO** en seis puntos concretos; vigente en el grueso |
| `checklists/requirements.md` | **HISTÓRICO** — no se toca; tres afirmaciones ya no son ciertas |
| `contracts/events.md` | **DESFASADO** — documenta 8 eventos, el código emite 3 |
| `plan.md` | **DESFASADO — el peor.** 8 de 15 filas del contexto técnico son falsas |
| `research.md` | **HISTÓRICO** — 9 decisiones reemplazadas de facto, sin nota |
| `data-model.md` | **DESFASADO — CORREGIDO HOY** |
| `tasks.md` | **DESFASADO** — el reparto de trabajo se apoya en una premisa caída |
| `quickstart.md` | **DESFASADO — CORREGIDO HOY** |
| `entrega-frontend.md` | *(ver sección)* |
| `barrido-qa.md` | *(ver sección)* |
| `dashboard-administrativo.md` | *(ver sección)* |
| `infra/terraform/README.md` | **DESFASADO** |
| `.env.example` | **DESFASADO** — nombres de variable que el código no lee |

---

## Lo que cambió y todavía no está en todas partes

Cinco cambios recientes son la causa de la mayor parte del desfase:

1. **El cierre pasó a ser mensual.** `cierre_inventario` tenía `bodega_id` como clave primaria: una bodega solo se podía cerrar **una vez en la vida del sistema**, y el mes siguiente devolvía `INVENTARIO_YA_CERRADO` para siempre. Desde la migración `0016_periodos` la clave es `id` y la unicidad es `(bodega_id, periodo)`. Aparecen dos tablas nuevas: `consolidado_historico` (la foto append-only de lo que se avaló ese mes, con nombre, código y unidad desnormalizados a propósito) y `costo_articulo` (**vacía**: el archivo del cliente no trae precios).
2. **El módulo `metricas` no existía.** Es el Dashboard Administrativo: `/admin` con cuatro pantallas y sus endpoints `/metricas/*`.
3. **El rol `admin` en el frontend.** El mismo formulario de ingreso lleva a cada rol a su pantalla; no hay selector. El Supervisor entra al mismo tablero que el Administrador.
4. **La guarda de bodega.** `platform/autorizacion/bodega.guard.ts` ya no comprueba solo el rol: también que la bodega esté **asignada** al usuario (`usuario_bodega`).
5. **Los proveedores dejaron de ser una suposición.** La voz del agente la sintetiza **Amazon Polly** (la capa gratuita de Gemini da diez síntesis al día por modelo, y un conteo real las agota en minutos); **escuchar** sigue siendo Gemini Live; el árbitro corre en `determinista`; el ERP y Deepgram siguen en **simulado** por falta de credenciales reales. Los conmutadores están declarados explícitamente en SSM por Terraform, no heredados de los valores por defecto del código.

---

## `SPEC.md` (raíz) — HISTÓRICO

Es el encargo original del cliente y la autoridad sobre el comportamiento del producto (Constitución, Principio IX). **No se toca.** Si el sistema hace algo distinto de lo que dice, lo que está mal es el sistema, no el documento.

Dos supuestos suyos siguen siendo supuestos y así están marcados en §7: la resolución del Auditor como valor final irrefutable, y el historial visible de los últimos 3–5 productos.

Un punto que la implementación amplió sin contradecirlo: §2 nombra tres roles (Operador, Auditor, Administrador). El sistema tiene un cuarto, **Supervisor**, en modo solo lectura (decisión D-10). No es una desviación del encargo, es una adición — pero conviene saber que el SPEC no lo menciona.

---

## `.specify/memory/constitution.md` — AL DÍA (con dos desviaciones)

Los nueve principios y las seis restricciones siguen siendo los que gobiernan el diseño, y el código los cumple. Dos matices que quien audite debe conocer, y que son desviaciones **del código respecto a la Constitución**, no errores del documento:

- **Principio II — «Frontend y backend DEBEN poder desplegarse de forma independiente».** Hoy viajan en la **misma imagen** y el reparto de rutas lo hace nginx dentro de la instancia (`infra/nginx.conf`). La razón está documentada en `infra/terraform/cdn.tf`: la cookie de sesión es `SameSite=Strict` y exige mismo origen; tener la lista de rutas en CloudFront obligaba a un `terraform apply` de quince minutos para algo que es enrutado de aplicación. El desacoplamiento **lógico** que exige el principio se mantiene (el contrato es OpenAPI); el **operativo** no.
- **Principio III — dominios mínimos.** El documento nombra cinco (`Identidad/Roles`, `Catálogo/Inventario`, `Captura`, `Auditoría`, `Integración/Exportación`). El backend tiene diez: se añadieron `consolidacion`, `aprendizaje`, `presencia`, `consulta` y `metricas`. Son *mínimos*, así que no hay contradicción, pero el documento no anticipa el mapa real.

---

## `plan.md` — DESFASADO (el más grave)

Es el documento que describe el stack **actual**, y por eso su desfase duele más que el de `research.md`. Ocho de las quince filas de su tabla de contexto técnico (§2) son falsas hoy:

| Fila | Afirma | Es |
|---|---|---|
| Frontend | Vite 6 + React 19, PWA con Workbox | **Next.js 16.2.6** (App Router, `output: 'standalone'`), Tailwind 4 + shadcn/base-ui. No hay Vite en ningún `package.json`, ni Workbox, ni manifest, ni service worker |
| Cliente local | IndexedDB vía Dexie como *write-ahead log* | Dexie no es dependencia. IndexedDB solo guarda **audio** (`frontend/lib/audio-store.ts`). La cola de conteos está en `localStorage` |
| Voz | Deepgram Flux · WebRTC · Silero VAD · `speechSynthesis` | Ninguna de las cuatro. El audio va por WebSocket propio a **Gemini Live**, PCM 16 kHz sin WebRTC ni VAD; el readback lo hace **Amazon Polly** en servidor |
| LLM | `claude-opus-5` vía OpenRouter para excepciones y Árbitro | El código existe y está **apagado en los dos frentes**: `PROVEEDOR_INTERPRETACION=simulado`, `PROVEEDOR_ARBITRAJE=determinista` |
| Consulta supervisor | Grok Voice Agent (`wss://api.x.ai`) | `PROVEEDOR_AGENTE_VOZ=gemini`. `grok.ts` sobrevive sin verificar |
| Cola / eventos | Outbox transaccional + **pg-boss** | pg-boss no es dependencia de nadie. `platform/eventos/outbox.ts` lo descarta por escrito: «el outbox YA es la cola» |
| Pruebas | Vitest · Supertest · **Playwright (+ axe)** · k6 | Playwright y axe no están instalados. CI corre typecheck, lint, migración ida y vuelta, seed, vitest, k6 y terraform |
| Despliegue | Frontend en **S3 + CloudFront** | Una sola instancia EC2 con **nginx** repartiendo API `:3000` y Next `:3001`. CloudFront quedó con **un solo origen** |

Tres desfases más, fuera de la tabla:

- **§3 y §4.2 — «seis módulos NestJS».** Son diez. Faltan `aprendizaje`, `consulta`, `presencia` y `metricas`, y ninguno tiene fila en la tabla de responsabilidades.
- **§4.3 — «el backend nunca sostiene una conexión de voz (D-07-A)». Está invertido.** `proveedores/agente-voz/puente-voz.ts` monta un `WebSocketServer` en `/voz/sesion`, autentica el *upgrade* a mano y hace de puente hacia Gemini; `presencia.gateway.ts` sostiene otro. **Lo que corre es la «opción B»** que el propio plan avisó que cambiaría las cosas (§8, riesgos). Ocurrió y no se escribió.
- **§6.1 — «el frontend lo desarrolla y despliega otro integrante, en su propio repositorio». Falso.** `frontend/` está en este monorepo, se llama `@cci/web`, está en `pnpm-workspace.yaml` y lo arrancan los scripts de la raíz. Es la afirmación más costosa del documento porque de ella cuelga todo el reparto de `tasks.md`.

**No menciona en absoluto**: el cierre mensual por periodo, el módulo `metricas` y `/admin`, la guarda de bodega, y la capa `proveedores/sintesis/`. El presupuesto de rendimiento de §5 mide un pipeline (VAD + Flux + transcripción final) que ya no existe.

---

## `research.md` — HISTÓRICO, con nueve decisiones revocadas de facto

Fechado 2026-07-24. Su formato («elegida · alternativas · reemplazo previsto») lo hace legítimamente histórico y **no está mal por ser viejo**. El matiz: ya rectifica en línea dos veces (D-05 y D-07, ambas el 2026-07-25), lo que establece que este documento **sí se actualiza** — y por eso los silencios se leen como vigencia. Quien lo consulte hoy debe saber que estas nueve fueron reemplazadas en la práctica:

| Decisión | Dice | Corre |
|---|---|---|
| **D-03** | Vite + React, **no** Next.js (seis párrafos argumentándolo) | Next.js 16 con Server Components. Es la reversión más frontal del documento |
| **D-06** | STT con Deepgram Flux | Nunca se encendió. El STT lo hace Gemini Live dentro del agente |
| **D-07** | ✅ «cerrada en A»: navegador → Deepgram directo | Opera en **B**: el audio atraviesa nuestro servidor. El endpoint de A (`POST /voz/token/:rondaId`) existe sin consumidor |
| **D-09** | LLM de excepciones y Árbitro con `claude-opus-5` | Ambos apagados. El árbitro es `determinista.ts` |
| **D-10** | Modo consulta con Grok Voice Agent | Gemini Live |
| **D-11** | WebRTC + Silero VAD en el navegador | WebSocket con `AudioContext` a 16 kHz. Ni WebRTC ni ONNX/Silero en el repo |
| **D-12** | Readback por `speechSynthesis` («es gratis, funciona sin red») | **Amazon Polly en servidor.** Su «alternativa descartada» —TTS en la nube— es justo lo que se hizo |
| **D-14** | Outbox + pg-boss | El outbox es la cola. La mitad de la decisión (outbox transaccional, idempotencia por `event_id`) **sigue vigente**; la del transporte, no |
| **D-15** | IndexedDB (Dexie) como WAL | No implementado |
| **D-25** | Frontend en S3 + CloudFront | Next en la misma instancia tras nginx. **El resto de D-25 sigue exacto**: EC2 + Docker Compose, ASG escrito y no construido |

**Siguen vigentes y verificables en el código**: D-01, D-02, D-04, D-05, D-08 (gramática determinista compartida), D-13 (append-only con `UPDATE`/`DELETE` revocados), D-16 (doble sello de tiempo), D-18 (Redis), D-19 (`pg_trgm` + alias con sus dos umbrales), D-20 (argon2id + cookie), D-21, D-22 (Zod en `packages/contracts`), D-23 (OTel), D-24 (ERP tras un puerto, simulado, `oracle.ts` sin verificar tal como se anticipó).

**D-17** (cacheo de prompts con TTL de 1 h) es un caso aparte: el código está escrito y no se ejecuta, porque el proveedor está apagado. Vigente en el papel, muerto en operación.

**§Costos es obsoleto por construcción**: todo el modelo se apoya en «STT ≈ 50% del gasto» con tarifa de Deepgram y OpenRouter. Hoy no se paga ninguno de los dos; se paga Gemini Live + Polly. Las advertencias de «precios por verificar» siguen sin verificarse.

---

## `tasks.md` — DESFASADO

Tres problemas, en orden de gravedad:

1. **La premisa del reparto se cayó.** Todo el sistema de marcas 🟦/🟨/🟪 cita `plan.md §6.1` («el frontend va en otro repositorio»). Como el frontend **está en este repo**, cada 🟨 marcada «✅ requisito entregado al compañero» es hoy una tarea abierta de este equipo: **F-18** (Dexie/WAL), **F-21** (Service Worker + catálogo cacheado), **F-21b**, **F-22**, **F-25** (WebRTC + Silero VAD), **F-30** (readback por `speechSynthesis`, hoy Polly). Lo mismo con `H1-06`, `H6-01`, `H6-03` y `H6-05`.
2. **El inventario de migraciones se detiene en 0010, de 17.** No hay tarea para `0011_fantasmas`, `0012_resolucion`, `0013_aliases_aprobados`, `0014_consulta`, `0015_propuestas`, ni para **`0016_periodos`** —el cambio de modelo de datos más grande desde la Fase 2— ni para `0017_unicidad_discrepancia`.
3. **Hay ✅ sobre cosas que no existen.** `F-08` da por hecho un script `contracts:generate` (Zod → OpenAPI) con verificación de deriva en CI: **no existe el script**, no hay `zod-to-openapi`, no hay paso de deriva, y `contracts/openapi.yaml` se mantiene a mano. `F-10` marca pg-boss ✅. `F-23`/`F-24` marcan el adaptador de Deepgram y «D-07 cerrada en A» ✅. `F-28` marca el intérprete de OpenRouter ✅, apagado y sin inyectar. `H4-05` está **invertido**: dice «Árbitro `claude-opus-5` ✅ con respaldo determinista», y el determinista es el modo activo. `H9-01`/`H9-03` describen un candado sobre Grok, que ya no se usa.

Menores: `S-04` dice seis módulos vacíos (son diez); `S-05` dice que el esqueleto Vite «sale de este repositorio» (ni sale, ni es Vite, ni es PWA); la nota «falta levantar Docker y correr `pnpm db:verificar`» quedó atrás — hay despliegue real en EC2 y CI corre la verificación en cada push; `C-02`/`C-03` dependen de Playwright, Lighthouse CI y axe, ninguno instalado.

**Slices que faltan por completo**: el módulo `metricas` y el tablero `/admin` (existe `dashboard-administrativo.md` con 790 líneas y `tasks.md` ni lo enlaza), el cierre mensual por periodo, la guarda de bodega, el módulo `presencia` y la capa de síntesis.

---

## `data-model.md` — DESFASADO · **corregido hoy**

Era el documento con el desfase más caro, porque afirma cómo **es** el esquema y quien lo lea va a creerle. Lo corregido en esta pasada:

| §  | Decía | Es |
|---|---|---|
| 2.1 | `cierre_inventario` — `bodega_id`, `cerrado_en`, `cerrado_por`, `hash_consolidado` | Tiene `id` PK y `periodo date`; la unicidad es `(bodega_id, periodo)`. El cierre es **mensual** (0016) |
| 2.1 | `consolidado_historico` no existía | Añadida con sus columnas y el porqué de la desnormalización |
| 2.2 | `costo_articulo` no existía | Añadida, **declarando que nace vacía** y que el tablero informa en unidades mientras no haya costo cargado |
| 2.2 | `usuario_bodega` no se mencionaba | Añadida: es la tabla que consulta la guarda de bodega |
| 2.2 | `articulo` sin bodega | El artículo es **por bodega** (`bodega_id` en la tabla, `UNIQUE (bodega_id, nombre)`) |
| 3 | El `REVOKE` no cubría la foto del mes | Añadido `consolidado_historico` |
| 4 | Tabla de migraciones **0001–0010** | Hay **17**. Añadidas 0011–0017 |
| 5 | Faltaban cuatro índices de ruta caliente | Añadidos `discrepancia (bodega_id, articulo_id)` UNIQUE, `registro_conteo (articulo_id)`, `cierre_inventario (periodo, bodega_id)` y los tres de `consolidado_historico` |

**Lo que NO se tocó y sigue siendo cierto**: la separación libro/proyección/referencia, el mecanismo de supersedencia por secuencia, las restricciones `CHECK` de `articulo_consolidado`, las reglas de reversibilidad y la sección de retención de datos personales.

**Queda pendiente (caro, no se hizo)**: §2.3 describe `discrepancia` con estados `abierta`/`en_reconteo`/`cerrada`; la migración 0012 (`pendiente_de_resolver`) y el cambio de hoy sobre hallazgos resueltos sugieren que el ciclo real es más rico. Verificar contra `modules/auditoria` antes de reescribirlo.

---

## `quickstart.md` — DESFASADO · **corregido hoy**

El documento pedía correr comandos que **nunca existieron**. Lo corregido:

| §  | Decía | Es |
|---|---|---|
| 1 | `pnpm 9+` | `pnpm 10+` (`packageManager: pnpm@10.31.0`, `engines.pnpm: >=10`) |
| 1 | Credenciales: `DEEPGRAM_API_KEY`, `OPENROUTER_API_KEY` | Deepgram y Oracle **nunca se cargaron**; las que importan hoy son `GEMINI_API_KEY` (agente de voz) y `OPENROUTER_API_KEY` (árbitro/interpretación) |
| 2 | `pnpm dev # api :3000 · web :5173` | `pnpm dev` levanta **solo la API**. El frontend es **Next.js**, no Vite, y se levanta aparte con `pnpm --filter @cci/web dev`; el mismo origen lo resuelve el `rewrites` de `next.config.mjs` |
| 2 | «una bodega con 120 artículos, tres usuarios» | Se siembra desde `apps/api/datos/bodegas-y-stock.xlsx`: **una bodega por hoja de stock**, con sus artículos reales y **saldos negativos incluidos**, más **cuatro** usuarios |
| 2 | No había credenciales de demostración | Añadidas: `1000000001`/`02`/`03`/`04`, clave `Inventario2026*`, la URL desplegada y a qué pantalla entra cada rol |
| 2 | «Modo simulado por defecto sin credenciales» | Matizado: el ERP y Deepgram sí están simulados; **Gemini Live y Polly están encendidos** |
| 3 | `pnpm test:e2e`, `test:contract`, `test:integration`, `test:perf`, `test:lighthouse`, `test:a11y`, `test:security` | **Ninguno existe.** Todo corre con `pnpm test` (vitest). Cada escenario ahora apunta a los ficheros reales de `apps/api/test/` |
| 4 | `pnpm verify = tipos + lint + unit + contract + integration + e2e + a11y + perf + security` | `pnpm verify = build + typecheck + lint + test` |
| 5 | `pnpm contracts:generate`, `pnpm metrics:latency` | No existen. Sustituidos por `db:seed`, `db:verificar` y `reconstruir`, que sí |

**Se dejó dicho, no se ocultó**: E10 (accesibilidad) no tiene runner automatizado, y de E9 solo corre la parte de API — Lighthouse y k6 no están cableados. Los umbrales del Principio VII siguen escritos como umbrales, pero hoy **no fallan la build** en la parte de frontend.

**Queda pendiente (caro)**: §6 punto 3 dice «resolver la decisión D-07 (dónde se conecta el proveedor de voz)». Ya está resuelta de hecho — el navegador habla con Gemini Live y la API sintetiza con Polly — pero reescribir esa sección exige revisar D-07 completo en `research.md`.

---

## `infra/terraform/README.md` — DESFASADO

Describe la infraestructura que **había**, no la que hay. Cuatro cosas:

1. **§«Qué levanta» no menciona CloudFront**, que es lo primero que ve cualquiera: la demostración vive en `https://d1jhay4xdswind.cloudfront.net`. La tabla lista VPC, EC2, ALB, RDS, ElastiCache, S3, ECR y SSM, pero no la distribución (`cdn.tf`), que es la que da TLS y puerto 443 — y sin la cual la PWA no tendría contexto seguro.
2. **§«Uso» — la lista de parámetros SSM está incompleta.** Dice cargar `DEEPGRAM_API_KEY` y `OPENROUTER_API_KEY`. Terraform crea siete secretos (`DEEPGRAM_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`, `ERP_BASE_URL`, `ERP_USUARIO`, `ERP_PASSWORD`) con el texto `PENDIENTE-cargar-con-aws-ssm-put-parameter`, y además cinco **conmutadores** en claro (`PROVEEDOR_VOZ`, `PROVEEDOR_AGENTE_VOZ`, `PROVEEDOR_ARBITRAJE`, `PROVEEDOR_INTERPRETACION`, `PROVEEDOR_ERP`). El README no los menciona, y son justo los que explican en qué modo corre producción.
3. **§«Uso» no dice nada de Polly**, que es hoy la voz del sistema. No lleva credencial —la instancia firma con su rol de IAM (`computo.tf`, `SintetizarVozDelAgente`)— y por eso es fácil no enterarse de que está ahí. `PROVEEDOR_TTS` **no está declarado en SSM**: hoy toma el valor por defecto de `config.ts` (`polly`). Eso contradice la propia razón que `secretos.tf` da para declarar los otros conmutadores («un default es una suposición; esto es una declaración») y **debería añadirse al mapa `conmutadores`**.
4. **§«Lo que este directorio NO despliega: el frontend» es falso.** El frontend viaja en la misma imagen y lo sirve nginx desde la instancia; CloudFront incluso tiene un comportamiento dedicado para `/_next/static/*`. El párrafo describe una arquitectura de dos orígenes que `cdn.tf` explica haber **abandonado**.

Lo que sigue siendo cierto: la ausencia deliberada de NAT Gateway, el acceso por SSM sin puerto 22, la construcción para `linux/arm64`, el escalado por `SesionesActivas` y toda la advertencia sobre la política de IAM y la escalada de privilegios.

---

## `spec.md` — DESFASADO en puntos concretos, vigente en el grueso

Es el documento central (754 líneas) y el núcleo funcional —D1 a D8, las historias 1 a 8, la inmensa mayoría de los 85 FR— sigue describiendo lo que el código hace. Miente en seis sitios:

1. **§6 «Fuera de alcance del MVP» (línea 730)** — dice que quedan fuera «tableros analíticos e informes históricos más allá del consolidado de un inventario». Es exactamente lo que se construyó: `modules/metricas` expone siete rutas (`/metricas/periodos`, `/resumen`, `/detalle`, `/historia`, `/articulo`, `/causas`, `/autopulido`), `metricas.service.ts` compara meses con `generate_series`, y hay cuatro pantallas en `/admin`.
2. **§5 «Entidades del dominio» (líneas 700-715)** — no existe la noción de **periodo**, ni de **consolidado histórico**, ni de **costo unitario**. Describe «Consolidado de bodega» (línea 711) como una vista viva única. Historia 7 (desde la línea 584) habla de «un inventario cerrado» en singular; el sistema cierra **uno por mes**.
3. **§5 línea 703** — «Rol: Operador, Auditor o Administrador». Hay un cuarto: `supervisor` (`packages/contracts/src/comun.ts`), con módulo propio (`modules/consulta`) y lectura sobre las siete rutas de métricas. Ninguna historia lo cubre.
4. **FR-4.9 (línea 441)** — «restringir el acceso a la vista de auditoría al rol Auditor». Hoy `auditoria.controller.ts` marca `@Roles('auditor','administrador')` en las cuatro rutas de lectura; solo el reconteo y la resolución de fantasma son exclusivos del Auditor.
5. **El modelo de autorización creció y ningún FR lo dice.** El spec razona siempre en términos de rol. `platform/autorizacion/bodega.guard.ts` añadió una segunda dimensión: consulta `usuario_bodega` y devuelve `PROHIBIDO` si la bodega no está asignada, aunque el rol sea correcto. FR-1.3 solo exige «seleccionar una bodega».
6. **Tres módulos no derivan de ninguna historia**: `aprendizaje` (alias, propuestas, crítica de rondas), `presencia` (WebSocket + Redis) y `consulta`. Y §6 línea 726 sigue diciendo que dar de alta fantasmas en el catálogo está fuera de alcance, mientras existe `POST /aprendizaje/alias` y la migración `0013_aliases_aprobados`.

**Lo que el spec afirma y sigue siendo cierto** — no reportarlo como desfase: FR-1.22, FR-2.6 y R1 se sostienen (la resolución de nombre es determinista en `catalogo/resolucion.service.ts`; Gemini Live solo transcribe y dialoga, no resuelve); FR-3.7 y FR-4.8 están en `consolidacion.service.ts`; FR-7.2 (CSV + XLSX) en `integracion.controller.ts`; FR-8.1 en `catalogo/mermas.controller.ts`; la Historia 6 es real, con cola en `localStorage` y clave de idempotencia en `frontend/lib/store.tsx`.

La dependencia declarada en la línea 635 (**Oracle Fusion Cloud**) sigue **sin verificar**: `PROVEEDOR_ERP` está fijado en `simulado` también en producción. Igual `PROVEEDOR_VOZ`: el adaptador de Deepgram existe (`proveedores/voz/deepgram.ts`) y no está encendido.

---

## `contracts/events.md` — DESFASADO (el peor de todos)

Documenta **ocho** eventos. El código emite **tres**, todos desde `modules/captura/ronda.service.ts`.

**Cinco eventos documentados que nadie publica**: `DiscrepanciaDetectada` (la discrepancia se abre con un `INSERT` directo en `consolidacion.service.ts`), `ArticuloConciliado`, `ReconteoRegistrado` (el módulo `auditoria` no importa el bus en ningún archivo), `InventarioCerrado` (el cierre escribe `cierre_inventario` y `consolidado_historico` en la misma transacción, sin outbox) y `InventarioExportado`. Existen como tipo Zod en `packages/contracts/src/eventos.ts`; no existen como comportamiento.

**La columna «Lo consume» es falsa en tres filas.** `ConteoRegistrado` dice consumirse en `consolidacion` — pero `consolidacion.service.ts` declara `interesadoEn = ['RondaCerrada', 'ProductoFantasmaRegistrado']`: el evento entra al outbox, se marca despachado y no dispara nada. `DiscrepanciaDetectada` dice `auditoria`, que no implementa `Consumidor`. `ArticuloConciliado` e `InventarioCerrado` dicen `integracion`, que tampoco lo es.

**Falta un consumidor real**: `aprendizaje/critico.service.ts` (`interesadoEn = ['RondaCerrada']`). El módulo `aprendizaje` ni aparece en el documento.

**Los payloads no cuadran con el esquema**: `ConteoRegistrado` documenta un `origenParse` que no existe y omite `bodegaId`, que sí; `ProductoFantasmaRegistrado` omite `bodegaId` y `fantasmaId`; `ReconteoRegistrado` documenta un `itemId` inexistente; `InventarioExportado` documenta un `destino` que en realidad es `formato: 'csv'|'xlsx'|'erp'` más `referenciaEnvio`; y `InventarioCerrado` **no lleva `periodo`**, así que tras la migración 0016 ni siquiera identifica el cierre del que habla.

**Lo que sí sigue vigente**: las cinco reglas de la sección final están todas implementadas — `bus.ts` exige la transacción en la firma, `despachador.ts` inserta `evento_procesado` antes del efecto y en la misma transacción, y `outbox.ts` valida el payload antes de escribir.

---

## `checklists/requirements.md` — HISTÓRICO, con tres afirmaciones que hoy son falsas

Es una compuerta de fase previa a la planeación. Su veredicto —«COMPUERTA ABIERTA, la planeación técnica queda habilitada»— es un artefacto de un momento que ya pasó, no una afirmación sobre el sistema de hoy. **No hay que tocarlo.** Los conteos de la tabla §B siguen cuadrando: 85 FR y 35 SC.

Con todo, tres cosas que ya no son ciertas, por si alguien lo lee como si fuera actual:

- **§E · III** — «la estructura de módulos corresponde al plan». `plan.md` dice seis módulos; hay **diez**.
- **§E · IV** — dice que los siete hitos del ciclo están definidos como transiciones observables. Solo **tres** llegaron al outbox. Discrepancia, consolidación, reconteo y cierre de inventario no son observables como evento.
- **§F** — enumera los flujos de Operador, Auditor y Administrador. Falta el **Supervisor**.

Defecto interno menor, anterior al código: el veredicto dice «los 42 ítems del checklist pasan»; el archivo tiene **45** casillas marcadas.

---

## `.env.example` — DESFASADO (no está en la carpeta de entrega, pero se copia a `.env`)

No es documentación de producto, pero `quickstart.md` manda copiarlo y **no arranca bien**. Nombra `ORACLE_FUSION_BASE_URL`, `ORACLE_FUSION_USER` y `ORACLE_FUSION_PASSWORD`; el código lee `ERP_BASE_URL`, `ERP_USUARIO` y `ERP_PASSWORD` (`config.ts`). Se pueden cargar las credenciales del ERP siguiendo el archivo al pie de la letra y que la aplicación no las vea nunca — es exactamente el fallo que `secretos.tf` documenta haber corregido en Terraform, y que en el `.env.example` sigue vivo. Faltan además `PROVEEDOR_TTS`, `PROVEEDOR_ARBITRAJE`, `PROVEEDOR_AGENTE_VOZ`, `GEMINI_API_KEY`, `XAI_API_KEY`, `BASE_URL_LLM` y `AWS_REGION`; `PROVEEDOR_INTERPRETACION` ofrece `openrouter` como valor cuando el enum real es `anthropic`; y `API_CORS_ORIGIN` apunta a `http://localhost:5173`, el puerto de Vite, que ya no se usa.

**No se corrigió aquí** porque es un archivo de configuración, no documentación. Es barato y vale la pena hacerlo.

---
