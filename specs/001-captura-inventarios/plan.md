# Plan de Implementación: Captura Inteligente de Inventarios (MVP)

**Feature**: `001-captura-inventarios` · **Fecha**: 2026-07-24
**Spec**: [spec.md](./spec.md) · **Investigación**: [research.md](./research.md) · **Datos**: [data-model.md](./data-model.md) · **Contratos**: [contracts/](./contracts/) · **Validación**: [quickstart.md](./quickstart.md)

---

## 1. Resumen

Reemplazar el conteo en papel de las bodegas de Colsubsidio por un **dictado por voz**: el Operador enuncia nombre, cantidad y unidad de lo que ve; una gramática determinista parte el enunciado y `pg_trgm` resuelve el nombre contra el catálogo de la bodega en menos de 5 ms. Si la resolución es inequívoca, se guarda; si no, el sistema **pregunta** mostrando candidatos en pantalla. El 90% de los turnos se cierra sin tocar un modelo de lenguaje. La validación contra el saldo esperado ocurre siempre en el servidor y su resultado nunca llega al dispositivo del Operador, que es lo que mantiene ciego el conteo. Cada persona trabaja en una **ronda propia e inmutable**; un artículo queda cerrado cuando el conteo ciego coincide con el saldo esperado dentro de tolerancia —la ceguera es la garantía: no se puede fabricar una coincidencia con un número que no se ve—, y todo lo demás llega al Auditor con la evidencia ordenada.

La arquitectura se organiza alrededor de tres invariantes: **el saldo no cruza al cliente**, **nada se actualiza en sitio**, y **el backend no guarda estado de sesión**.

---

## 2. Contexto Técnico

| | |
|---|---|
| **Lenguaje** | TypeScript 5.7, `strict: true`, sin `any` — cliente y servidor |
| **Runtime** | Node.js 22 LTS |
| **Backend** | NestJS sobre adaptador Fastify; módulo por dominio |
| **Frontend** | Vite 6 + React 19, PWA con Workbox |
| **Almacenamiento** | PostgreSQL 17 (append-only, `pg_trgm`) · Redis 7 (caché de aplicación) · S3 (evidencia de audio) |
| **Cliente local** | IndexedDB vía Dexie, como *write-ahead log* |
| **Voz** | Deepgram Flux Multilingual (STT) · WebRTC (transporte) · Silero VAD (dispositivo) · `speechSynthesis` (readback) |
| **LLM** | `claude-opus-5` vía OpenRouter — excepciones de parse y Árbitro. **Nunca en la ruta caliente** |
| **Consulta supervisor** | Grok Voice Agent (`wss://api.x.ai/v1/realtime`), solo lectura |
| **Contratos** | Zod como fuente única → tipos + validación runtime + OpenAPI 3.1 |
| **Cola / eventos** | Outbox transaccional + pg-boss |
| **Pruebas** | Vitest · Supertest · Playwright (+ `axe`) · k6 |
| **Objetivos** | 500 concurrentes · API p95 < 200 ms · ciclo de registro p95 < 1.500 ms · carga < 3 s en 4G |
| **Restricciones** | OWASP ASVS L2 · WCAG 2.1 AA · despliegues stateless e independientes · Ley 1581 de 2012 |
| **Despliegue** | API + worker en **EC2** (Docker Compose en el MVP; ASG + ALB en Terraform diseñado, no construido) · frontend en S3 + CloudFront · Lambda solo para trabajo por evento (D-25) |
| **Escala** | 7 sedes × ~50 bodegas = **~350 bodegas** · catálogo de miles de artículos por bodega · ~200.000 ítems contados/mes · ~350 operarios simultáneos en la ventana de conteo, dimensionado a 500 |

---

## 3. Verificación contra la Constitución

*Compuerta: debe pasar antes de la Fase 0 y volver a verificarse tras la Fase 1.*

| Principio | Cómo lo satisface el plan | Verificación |
|---|---|---|
| **I · Platform-First** | Toda la lógica vive tras la API; el frontend no tiene ruta privilegiada. Dominio genérico (`bodega`, `ronda`, `conteo`). Nada en los contratos asume pantalla, navegador o capacidad de voz. | Prueba de contrato: cada función de la UI existe como operación documentada en OpenAPI |
| **II · Separación Web/API** | El saldo esperado se resuelve y se compara **solo** en servidor (D-13, D-18). El cliente captura, renderiza y garantiza durabilidad. Frontend y backend son artefactos de build distintos. | Test que falla si alguna respuesta dirigida a rol Operador contiene el saldo o algo derivable de él |
| **III · Módulos aislados** | Seis módulos NestJS con frontera verificada por el compilador. Sin capa de utilidades con reglas. | Regla de lint que prohíbe importar rutas internas de otro dominio |
| **IV · Eventos** | Outbox escrito en la misma transacción que su causa; consumidores idempotentes por `event_id`; transporte tras interfaz. | Test de integración: si el consumidor falla, el evento permanece; si se entrega dos veces, el efecto es uno |
| **V · Seguridad y privacidad** | Usuario y contraseña, argon2id, rol deducido en servidor. Sin biometría. TLS. Sin audio ni credenciales en logs. Minimización de datos. | ZAP baseline + Semgrep en CI; revisión de campos de log |
| **VI · Tipado completo** | `strict: true`, `any` prohibido por lint, contratos derivados de un esquema Zod único, validación en runtime en toda frontera. | `tsc --noEmit` + regla `no-explicit-any` como error |
| **VII · Performance medible** | Umbrales con percentil por etapa (§5), verificados automáticamente. Una regresión falla la build. | k6 sobre la API; Playwright para el ciclo extremo a extremo; Lighthouse CI para el frontend |
| **VIII · Mobile-first, PWA, accesible** | PWA instalable, paridad voz/texto, confirmación visual **y** auditiva, WCAG 2.1 AA, operable con una mano. | `axe` en Playwright; recorrido manual con lector de pantalla |
| **IX · Guiado por especificaciones** | Este plan deriva de un spec con cero ambigüedades. D-07 queda marcada como decisión abierta, no resuelta por invención. | Checklist de requisitos aprobado antes de este plan |
| **R1 · Determinismo** | Gramática PEG resuelve el 90%; el LLM solo interpreta el 10% ambiguo y su salida vuelve a pasar por validación determinista. | Test: ninguna regla de validación invoca al proveedor de interpretación |
| **R2 · Durabilidad antes que red** | IndexedDB como WAL; idempotencia UUIDv7 desde el cliente; confirmación tras durabilidad local. | Playwright con red intermitente: 0 pérdidas, 0 duplicados |
| **R3 · Trazabilidad** | Cada registro guarda modo de captura, autor, momento (doble sello, D-16), bodega y ronda. | Restricción `NOT NULL` en el esquema |
| **R4 · Causa antes que ajuste** | Cierre de ítem auditable exige código de razón de catálogo controlado. | Clave foránea + test de integración |
| **R5 · Dependencias degradables** | Voz, LLM y ERP tras interfaz con camino alterno: voz→texto, LLM→pregunta al usuario, ERP→cola de reintento. | Test de caos: cada proveedor caído, el operario sigue trabajando |
| **R6 · Reproducibilidad** | Migraciones versionadas y **reversibles** (§data-model); comando de estado inicial conocido. | `pnpm db:reset` en CI |

**Resultado: pasa.** Sin violaciones que justificar; la tabla de complejidad queda vacía.

---

## 4. Arquitectura

### 4.1 Flujo de un turno de conteo

```
┌─ Dispositivo (stateless respecto al servidor) ──────────────────┐
│                                                                 │
│  Operador dicta: "platos cuadrados, tres unidades"              │
│         │                                                       │
│  Silero VAD (recorta silencio) ◀──── micrófono ◀────────────────┤
│         │                                                       │
│         └──WebRTC──▶ Deepgram Flux ──texto──▶ Gramática PEG     │
│                     (token efímero)                 │           │
│                     [D-07 · decisión abierta]       │           │
│                          <nombre> │ <cantidad> <unidad>         │
│                                   ▼                             │
│              resolución sobre catálogo cacheado (local)         │
│                       ┌───────────┴───────────┐                 │
│                  inequívoco            margen estrecho          │
│                       │                       │                 │
│                       │              candidatos en pantalla     │
│                       │              ── el Operador toca ──▶    │
│                       ▼                       │                 │
│               IndexedDB (WAL) ◀───────────────┘  confirma       │
│                       │                          al usuario     │
└───────────────────────┼─────────────────────────────────────────┘
                        │ HTTP + clave de idempotencia
                        ▼
┌─ API (stateless, cualquier réplica) ────────────────────────────┐
│  Validación Zod ▶ Captura ▶ [outbox + registro hijo] misma trx  │
│                                    │  (hereda saldo congelado)  │
│                          pg-boss ──┴─▶ Validación contra saldo  │
│                                          (Redis → Postgres)     │
│                                                │                │
│                       alerta de discrepancia ──┘ (asíncrona)    │
│                       = PREGUNTA, nunca el número de la base    │
└─────────────────────────────────────────────────────────────────┘
```

Dos cosas que el diagrama hace explícitas. **La resolución del nombre es determinista** (`pg_trgm` + alias): cuando el margen entre los dos mejores candidatos es estrecho, el sistema no elige — pregunta. Y **la alerta de discrepancia es una pregunta**, nunca un valor: *"¿estás seguro de que contaste X?"*. El saldo esperado no viaja al dispositivo ni como número, ni como rango, ni como valor por defecto.

El ~10% de enunciados que la gramática no logra segmentar se desvía a `claude-opus-5`, y su propuesta **vuelve** a la validación determinista y a la resolución por catálogo antes de guardarse. El modelo nunca elige el artículo.

### 4.2 Módulos de dominio

| Módulo | Responsabilidad | Publica | Consume |
|---|---|---|---|
| `identidad` | Autenticación, rol, autorización | — | — |
| `catalogo` | Artículos, unidades, saldos esperados, búsqueda `pg_trgm` | — | — |
| `captura` | Rondas, registros, cuadre de cierre, productos fantasma | `ConteoRegistrado`, `ProductoFantasmaRegistrado`, `RondaCerrada` | `catalogo` (interfaz) |
| `consolidacion` | Comparación contra el saldo esperado, clasificación conciliado/auditable | `DiscrepanciaDetectada`, `ArticuloConciliado`, `InventarioListo` | `ConteoRegistrado`, `RondaCerrada` |
| `auditoria` | Reconteo, códigos de razón, cierre | `ReconteoRegistrado`, `InventarioCerrado` | `DiscrepanciaDetectada` |
| `integracion` | Exportación CSV/XLSX, envío al ERP | `InventarioExportado` | `InventarioCerrado` |

Ningún módulo importa entidades internas de otro ni toca sus tablas. La comunicación es por interfaz publicada o por evento.

### 4.3 Por qué el sistema es stateless

Tres decisiones lo sostienen, y las tres son deliberadas: sesión en cookie firmada sin estado en servidor (D-20); audio directo navegador→Deepgram, de modo que el backend nunca sostiene una conexión de voz (D-07-A); y caché compartida en Redis, no en memoria del proceso (D-18). El resultado es que cualquier réplica atiende cualquier petición, un despliegue es un reemplazo sin *draining*, y no hay sticky sessions ni `idle_timeout` que gestionar.

**Si D-07 se resuelve por B, esto cambia** — y es la razón por la que la decisión importa.

---

## 5. Presupuesto de rendimiento

**Ciclo de registro de un ítem: p95 < 1.500 ms**, repartido y medido por etapa (D-23):

| Etapa | Presupuesto p95 | Dónde |
|---|---|---|
| Fin de turno (VAD + Flux) | 400 ms | Dispositivo + Deepgram |
| Transcripción final | 300 ms | Deepgram |
| Gramática PEG (segmentación) | 15 ms | Dispositivo |
| Resolución del nombre sobre catálogo cacheado | 20 ms | **Dispositivo** — ver nota |
| Escritura IndexedDB | 30 ms | Dispositivo |
| Readback + confirmación | 250 ms | Dispositivo |
| **Subtotal percibido** | **~1.000 ms** | **No depende de la red** |
| Envío + re-resolución y validación en servidor | 200 ms | API (asíncrono, no bloquea) |

La confirmación al Operador ocurre tras la escritura local: el presupuesto percibido no incluye la red. La validación llega después y se muestra como estado distinto (D-15).

> **La resolución del nombre corre en el dispositivo, no en la API.** Con captura libre, resolver el nombre es parte de cada turno; si dependiera de la red, un microcorte dejaría al Operador sin poder contar — lo que contradice la Historia 6 y la Restricción 5. El catálogo de la bodega **ya está en el dispositivo**: se descarga al abrir la ronda y el Service Worker lo cachea (F-21), y **no contiene el saldo esperado**, así que cachearlo no compromete el conteo ciego. Unos miles de artículos se recorren por similitud en el navegador en milisegundos.
>
> El servidor **vuelve a resolver** el nombre al recibir el registro y es la autoridad: si su resolución difiere de la del dispositivo, el registro se marca para revisión del Auditor en vez de corregirse en silencio. `origen_nombre` guarda cuál de las dos vías lo resolvió.

**API: p95 < 200 ms** en consultas y escrituras simples, con 500 concurrentes. El pico real de la API es ~35 req/s, no 500 rps: cada operario genera una escritura cada ~15 s y el audio no pasa por aquí.

**Frontend: < 3 s en 4G** — JS inicial ≤ 170 KB gzip, LCP < 2,5 s, TTI < 3 s (D-04).

Cada umbral se verifica automáticamente en CI. Una regresión **falla la build**; no genera un ticket.

---

## 6. Estructura del proyecto

### 6.1 Reparto de trabajo

> **Este repositorio construye el backend y su infraestructura. El frontend lo desarrolla y despliega otro integrante del equipo, en su propio repositorio.**
>
> La frontera entre los dos es el contrato OpenAPI, no un despliegue compartido — que es exactamente lo que exige el Principio II. Todo lo que el cliente necesita saber está en `contracts/openapi.yaml` y en el paquete `@cci/contracts`.
>
> **Consecuencia sobre las pruebas:** la prueba E2 (el conteo es realmente ciego) se parte en dos. La mitad del servidor —que ninguna respuesta dirigida a rol Operador contenga el saldo, ni derivado ni inferible— es nuestra y es la mitad fuerte. La mitad del cliente —que el saldo tampoco aparezca en el almacenamiento local tras una sesión completa— corresponde a quien construya el frontend, y hay que exigirla explícitamente.

```text
apps/
└── api/                          # NestJS sobre Fastify — desplegable independiente
    ├── src/
    │   ├── modules/              # los seis dominios, frontera verificada por lint
    │   │   ├── identidad/
    │   │   ├── catalogo/
    │   │   ├── captura/
    │   │   ├── consolidacion/
    │   │   ├── auditoria/
    │   │   └── integracion/
    │   ├── platform/             # bus de eventos, outbox, db, redis, telemetría
    │   └── proveedores/          # voz, interpretación, ERP — interfaces + adaptadores
    ├── drizzle/                  # migraciones versionadas y reversibles
    ├── scripts/                  # migrar.ts — up · down · reset · verificar
    └── test/                     # contract · integration · unit

packages/
└── contracts/                    # Zod → tipos + OpenAPI. SIN reglas de negocio.

infra/terraform/                  # TODO lo que vive en AWS. Nada se toca a mano.
├── red.tf · datos.tf · computo.tf · almacenamiento.tf · registro.tf · secretos.tf
├── escalado.tf                   # ALB + ASG: escrito, no construido en el MVP (D-25)
├── iam-despliegue.json           # política del usuario que ejecuta Terraform
└── entornos/mvp.tfvars

tests/perf/                       # k6
specs/001-captura-inventarios/    # este conjunto de documentos
```

**Decisión de estructura**: monorepo pnpm con la API y un paquete de contratos compartido. El monorepo satisface la fuente única de contratos (Principio VI) sin impedir el despliegue independiente (Principio II). El frontend queda fuera del monorepo precisamente porque lo construye otro equipo: su única dependencia es el contrato publicado.

**La infraestructura es código, sin excepciones.** Un recurso creado a mano en la consola no está en el estado, no se puede reproducir y desaparece en el siguiente `apply` de otra persona. Eso incluye los grupos de seguridad y los parámetros de SSM.

---

## 7. Seguimiento de complejidad

*Se llena solo si la verificación constitucional tiene violaciones que justificar.*

**Vacía.** Ninguna decisión del plan viola un principio. Las tres piezas que podrían parecer complejidad injustificada tienen su alternativa simple descartada por escrito en `research.md`: el outbox (contra `EventEmitter`, exigido por el Principio IV), el doble sello de tiempo (contra un solo campo, exigido por una contradicción real entre FR-6.8 y la operación offline) y Redis (contra caché en memoria, exigido por el despliegue stateless).

---

## 8. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| **D-07 se resuelve por B** | Vuelven sticky sessions y *draining*; cambia el despliegue | La interfaz `ProveedorDeVoz` aísla el cambio; decidir antes de la Fase 3 |
| Cobertura de la gramática < 85% | Sube costo y latencia por más llamadas a LLM | Medir desde el primer día en producción; ampliar gramática, no ampliar el LLM |
| Ruido de bodega degrada el STT | Turnos repetidos, frustración | Prueba en bodega real antes del cierre del MVP; camino alterno por texto siempre disponible |
| La coincidencia con el ERP resulta menos concluyente de lo supuesto | Se confirmarían artículos mal contados | La ceguera está verificada por `E2`; si el conteo dejara de ser ciego, D5 pierde su fundamento y habría que volver a exigir rondas múltiples |
| Muchas rondas simultáneas sobre una bodega | Contradicciones entre rondas inflan la bandeja del Auditor | FR-3.10 es deliberadamente conservadora; medir la tasa de contradicción en el piloto |
| Acceso a Oracle Fusion no llega | Bloquea la Historia 7 | Adaptador simulado (D-24); el resto del MVP no depende de él |
| Precios unitarios de STT no confirmados | El modelo de costos se mueve | Verificar tarifas antes de comprometer presupuesto (§Costos en research) |
