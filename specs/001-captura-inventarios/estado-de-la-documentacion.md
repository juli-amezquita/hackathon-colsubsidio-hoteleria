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
| `spec.md` | *(ver sección)* |
| `checklists/requirements.md` | *(ver sección)* |
| `contracts/events.md` | *(ver sección)* |
| `plan.md` | *(ver sección)* |
| `research.md` | **HISTÓRICO** con salvedades |
| `data-model.md` | **DESFASADO — CORREGIDO HOY** |
| `tasks.md` | *(ver sección)* |
| `quickstart.md` | **DESFASADO — CORREGIDO HOY** |
| `entrega-frontend.md` | *(ver sección)* |
| `barrido-qa.md` | *(ver sección)* |
| `dashboard-administrativo.md` | *(ver sección)* |
| `infra/terraform/README.md` | **DESFASADO** |

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

## `.env.example` — DESFASADO (no está en la carpeta de entrega, pero se copia a `.env`)

No es documentación de producto, pero `quickstart.md` manda copiarlo y **no arranca bien**. Nombra `ORACLE_FUSION_BASE_URL`, `ORACLE_FUSION_USER` y `ORACLE_FUSION_PASSWORD`; el código lee `ERP_BASE_URL`, `ERP_USUARIO` y `ERP_PASSWORD` (`config.ts`). Se pueden cargar las credenciales del ERP siguiendo el archivo al pie de la letra y que la aplicación no las vea nunca — es exactamente el fallo que `secretos.tf` documenta haber corregido en Terraform, y que en el `.env.example` sigue vivo. Faltan además `PROVEEDOR_TTS`, `PROVEEDOR_ARBITRAJE`, `PROVEEDOR_AGENTE_VOZ`, `GEMINI_API_KEY`, `XAI_API_KEY`, `BASE_URL_LLM` y `AWS_REGION`, y `PROVEEDOR_INTERPRETACION` ofrece `openrouter` como valor cuando el enum real es `anthropic`.

**No se corrigió aquí** porque es un archivo de configuración, no documentación. Es barato y vale la pena hacerlo.

---
