# Fase 0 — Investigación y Decisiones Técnicas

**Feature**: Captura Inteligente de Inventarios (MVP) · **Fecha**: 2026-07-24
**Entrada**: [spec.md](./spec.md) (D1–D6) · [Constitución v1.0.0](../../.specify/memory/constitution.md)

Cada decisión declara: **elegida · razón · alternativas descartadas · implementación MVP · limitación conocida · señal de escalado · reemplazo previsto.**

Objetivos de diseño que gobiernan todo el documento: **500 usuarios concurrentes · API p95 < 200 ms · carga < 3 s en 4G/5G · despliegues stateless e independientes · OWASP ASVS L2 · WCAG 2.1 AA.**

Escala real: **7 sedes × ~50 bodegas = ~350 bodegas**, un operario por bodega en la ventana de conteo. Los 500 concurrentes son ese número redondeado con margen.

---

## Bloque A — Plataforma

### D-01 · Runtime del backend: Node.js 22 + TypeScript

- **Elegida**: Node.js 22 LTS con TypeScript en modo estricto.
- **Razón**: el Principio VI exige tipado estricto **en todo el stack** y el Principio I exige un esquema de contrato único compartido entre cliente y servidor. Con un backend en otro lenguaje ese esquema se duplica y se desincroniza. Además el trabajo del backend aquí es I/O-bound (Postgres, Redis, HTTP al ERP), que es exactamente donde Node rinde.
- **Alternativas descartadas**: **Python/FastAPI** — *esta es una rectificación de una decisión previa mía*: era la opción equivocada porque obliga a mantener los contratos dos veces (Pydantic + TypeScript) y rompe el Principio VI. **Go** — excelente para la carga, pero el mismo problema de contrato duplicado y menos personal disponible.
- **Implementación MVP**: un solo proceso, `tsx` en desarrollo, `tsc` a ESM en producción.
- **Limitación conocida**: un hilo por proceso; una tarea CPU-bound bloquea el event loop.
- **Señal de escalado**: p99 del event loop lag > 50 ms sostenido, o CPU > 70% con RPS plano.
- **Reemplazo previsto**: mover el trabajo pesado a workers (`node:worker_threads`) o a un servicio aparte. El lenguaje no cambia.
- **Nota económica**: el lenguaje del backend es **irrelevante en el costo** (§Costos). La discusión suele irse aquí y es donde menos dinero hay.

### D-02 · Framework backend: NestJS

- **Elegida**: NestJS con un módulo por dominio (`identidad`, `catalogo`, `captura`, `consolidacion`, `auditoria`, `integracion`).
- **Razón**: el Principio III exige fronteras duras y que cada dominio se pueda extraer sin refactorizar su lógica. El sistema de módulos de Nest hace la frontera **verificable**: lo que un módulo no exporta, otro no puede importar. Con carpetas y disciplina la frontera existe solo hasta el primer viernes por la tarde.
- **Alternativas descartadas**: **Fastify pelado** — más rápido y liviano, pero la frontera es convencional; el Principio III pide lo contrario. **Hono** — igual problema, menos ecosistema.
- **Implementación MVP**: Nest sobre adaptador Fastify (no Express), un `Module` por dominio, `EventBus` inyectado por interfaz.
- **Limitación conocida**: sobrecarga de arranque (~300 ms) y una capa de indirección que cuesta al leer.
- **Señal de escalado**: cuando dos dominios necesiten escalar por separado (ej. captura a 500 concurrentes vs. exportación con 3 usuarios).
- **Reemplazo previsto**: extraer el módulo a su propio despliegue; el `EventBus` in-process pasa a bus externo (D-07) sin tocar la lógica del dominio.

### D-03 · Frontend: Vite + React + TypeScript como PWA — **no** Next.js

- **Elegida**: SPA con Vite, React 19, TypeScript, instalable como PWA.
- **Razón**: es la decisión más consecuente del plan. El Principio II prohíbe lógica de negocio en el cliente y el conteo ciego (FR-1.18) exige que el saldo esperado **nunca** llegue al dispositivo. Next.js invita permanentemente a poner lógica "del lado servidor pero dentro del frontend" (Server Actions, Route Handlers), que es exactamente la frontera que el Principio II declara indivisible. Vite produce un bundle estático servido por CDN: no hay dónde alojar lógica de servidor por accidente. La separación deja de depender de la disciplina y pasa a ser estructural. Además da control explícito del Service Worker, que la Historia 6 necesita.
- **Alternativas descartadas**: **Next.js** — tentación arquitectónica permanente y Service Worker de segunda clase. **App nativa** — prohibida por el Principio VIII.
- **Implementación MVP**: `vite-plugin-pwa` (Workbox), rutas con lazy loading, presupuesto de bundle en CI.
- **Limitación conocida**: sin SSR; el primer render depende de JS. Con el presupuesto de D-04 no compromete el objetivo de 3 s.
- **Señal de escalado**: si alguna vista pública llegara a necesitar SEO o TTFB de servidor.
- **Reemplazo previsto**: prerender estático de esa vista concreta. No migrar la app entera.

### D-04 · Presupuesto de carga: < 3 s en 4G

- **Elegida**: presupuesto duro de **170 KB gzip de JS inicial**, LCP < 2.5 s en 4G simulada (Slow 4G: 400 kbps, RTT 400 ms), TTI < 3 s.
- **Razón**: "< 3 s en 4G/5G" no es verificable sin un número de bytes. 4G real en bodega ≈ 1.5 Mbps con latencia alta; 170 KB es el punto donde el presupuesto se cumple con margen.
- **Alternativas descartadas**: medir solo en 5G (esconde el problema); no presupuestar y "optimizar después" (nunca ocurre).
- **Implementación MVP**: `rollup-plugin-visualizer` + `size-limit` en CI; Lighthouse CI con throttling 4G; la ruta de conteo carga sin depender de librerías de gráficas ni de la vista de auditoría.
- **Limitación conocida**: el modelo VAD (D-11) pesa ~1.8 MB en WASM y no cabe en el presupuesto inicial.
- **Señal de escalado**: presupuesto excedido en CI.
- **Reemplazo previsto**: el VAD se carga **después** del primer render, en paralelo con la sesión, y se cachea en el Service Worker; el primer conteo no lo espera (degrada a *push-to-talk*).

---

## Bloque B — Voz (donde más se movió el diseño)

### D-05 · Modelo de interacción: captura libre con resolución determinista del nombre

> **Rectificación del 2026-07-25.** Este apartado decía *trabajo dirigido* (spec D6). El negocio **revocó D6** y restableció la captura libre como D7. Lo que sigue es la decisión vigente.

- **Elegida**: el Operador **dicta lo que ve** — nombre, cantidad y unidad en un mismo enunciado. El sistema resuelve el nombre contra el catálogo de la bodega por similitud de texto (D-19), confirma y guarda si la resolución es inequívoca, y **presenta candidatos en pantalla** cuando no lo es. No propone artículos ni impone orden. (Spec D7.)
- **Razón**: el Operador conoce su bodega y su recorrido (G-7). Conducirlo por un catálogo de miles de referencias —la mayoría ausentes de esa bodega— es más lento que dejarlo enunciar lo que tiene delante. Y la desambiguación de nombre, que era el argumento a favor de dirigir, **se resuelve de forma determinista**: el catálogo es cerrado y pequeño, `pg_trgm` lo recorre en menos de 5 ms, y cuando el margen entre los dos mejores candidatos es estrecho el sistema **pregunta** en vez de adivinar. No hace falta un modelo de lenguaje en ningún punto de este flujo.
- **Alternativas descartadas**: **trabajo dirigido** (D6, revocada) — elimina la desambiguación de nombre, pero a costa de recorrer el catálogo entero y de imponer un orden que el operario ya tiene en la cabeza. **LLM para resolver el nombre** — viola la Restricción 1: elegir un artículo de un catálogo cerrado es selección, no generación.
- **Implementación MVP**: gramática que separa el enunciado en `<nombre> <cantidad> <unidad>` (D-08) + resolución del nombre por `pg_trgm` con dos umbrales: uno de aceptación y uno de **margen** entre el primer y el segundo candidato. Si el margen es estrecho, se presentan candidatos aunque el primero supere el umbral de aceptación.
- **Limitación conocida**: el turno es más largo que en trabajo dirigido —el operario pronuncia también el nombre—, lo que sube el audio facturado por ítem (≈ +50% de STT, ≈ +25% del costo total; ver §Costos). Y aparece una ambigüedad estructural que el flujo dirigido no tenía: **nombres de artículo que contienen números** ("aceite 3 litros"), donde hay que decidir qué número es la cantidad.
- **Señal de escalado**: tasa de desambiguación manual > 10% de los turnos, o errores de resolución detectados por el Auditor.
- **Reemplazo previsto**: ampliar el diccionario de sinónimos y alias por bodega —cómo llama la gente a las cosas, que rara vez es como las llama el ERP— antes que tocar el algoritmo. Es donde está la mejora barata.
- **Nota sobre el orden**: G-7 hace que el Operador recorra siempre igual, pero el sistema **no necesita saberlo**: no propone artículos. No hay lista dirigida, ni orden aprendido, ni columna de ubicación. La estabilidad del recorrido es un beneficio operativo, no un requisito del software.

### D-06 · STT: Deepgram Flux Multilingual

- **Elegida**: Deepgram Flux Multilingual como proveedor de reconocimiento de voz, detrás de la interfaz `ProveedorDeVoz`.
- **Razón**: tres propiedades que el flujo necesita y que un STT genérico no da. **(1) Fin de turno integrado** — el modelo decide cuándo el hablante terminó, en vez de que nosotros inventemos un umbral de silencio; en bodega con ruido, un umbral fijo corta al operario a media frase o espera de más. **(2) Español con formateo de numerales** — devuelve `19.8`, no "diecinueve punto ocho"; sin eso hay que escribir un normalizador de números en español, que es precisamente el código que más se rompe. **(3) Self-hosteable** — si Colsubsidio exige que el audio no salga de su infraestructura, la arquitectura no cambia, solo el endpoint.
- **Alternativas descartadas**: **Web Speech API** — descartada explícitamente: calidad de español inconsistente entre navegadores, sin formateo de numerales, sin control de fin de turno, sin opción self-host, y en Chrome envía audio a Google de todos modos. **Whisper self-hosted** — excelente transcripción, pero es batch: no tiene fin de turno y añade latencia de segundos, incompatible con el ciclo de 1.500 ms.
- **Implementación MVP**: streaming en tiempo real; solo se conserva el texto, no el audio (salvo el clip local de evidencia, D-07).
- **Limitación conocida**: dependencia de un proveedor externo con costo por minuto; es **la primera palanca de costo** (§Costos).
- **Señal de escalado**: costo de STT > 60% del total, o exigencia contractual de no-salida de datos.
- **Reemplazo previsto**: Flux self-hosted en la VPC. Mismo modelo, mismo contrato, cambia la URL.

### D-07 · Dónde se conecta Deepgram — ✅ CERRADA el 2026-07-25 en la opción A

Fue una decisión real con un trade-off real. **Cerrada en A**, y reversible: todo el proveedor vive tras la interfaz `ProveedorDeVoz`, así que pasar a B afecta al despliegue del backend y a esa interfaz, nunca a los dominios.

| | **A. Navegador → Deepgram directo** *(recomendada)* | **B. Audio a través de nuestro servidor** |
|---|---|---|
| Backend | **Stateless** — recibe texto por HTTP | **Stateful** — mantiene la sesión de audio |
| Consecuencias | Ninguna | Vuelven sticky sessions, `idle_timeout` 3600 s y *draining* en cada despliegue |
| Credencial | Token efímero (60 s, un solo uso) emitido por nuestra API | Nuestra credencial, nunca expuesta |
| Latencia | Un salto menos | Un salto más (~40–80 ms) |
| Evidencia de audio | Clip grabado local y subido diferido a S3 | Capturable en el servidor al vuelo |

- **Elegida (recomendación)**: **opción A** — el navegador habla directo con Deepgram usando un token efímero; el backend solo recibe texto y permanece stateless. El audio se graba localmente y se sube diferido a S3 para conservar la evidencia (Restricción 3).
- **Razón**: la opción B reintroduce exactamente lo que el objetivo "despliegues stateless e independientes" nos permitió eliminar. Sticky sessions convierten cada despliegue en una operación de *draining* de una hora y atan un usuario a una instancia. El costo de A es que la evidencia de audio llega diferida en vez de inmediata — y la evidencia que el negocio exige (Restricción 3) es *cómo se capturó*, no el audio en sí.
- **Alternativa descartada (B)**: sostenible, pero paga con la propiedad arquitectónica más valiosa del plan.
- **Implementación MVP**: endpoint `POST /sesiones-voz/token` que emite el token efímero, con límite por usuario y por minuto; el clip se sube cuando hay red, con la misma clave de idempotencia del registro.
- **Limitación conocida**: si el dispositivo se pierde antes de sincronizar, el audio de evidencia se pierde (el **registro** no — está en IndexedDB y ya se envió).
- **Señal de escalado**: si auditoría o un ente de control exige el audio en el momento, no diferido.
- **Reemplazo previsto**: conmutar a B **solo para las bodegas que lo exijan**, detrás de la misma interfaz `ProveedorDeVoz`. No es un cambio global.

### D-08 · Parser de gramática determinista — el 90% de los turnos sin LLM

- **Elegida**: gramática determinista (PEG) sobre el texto de Deepgram, que parte el enunciado en `<nombre> <cantidad> <unidad>` sin tocar un modelo de lenguaje. El nombre extraído se entrega a `pg_trgm` (D-19); la cantidad y la unidad las resuelve la gramática.
- **Razón**: la Restricción Técnica 1 **prohíbe** delegar a un modelo una regla expresable como condición. Con captura libre (D-05/D7) el turno es *"platos cuadrados, tres unidades"*: la **cola numérica** está acotada —"tres unidades", "20 kg", "veinte con cinco kilos", "cero"— y lo que la precede es el nombre. Separar esas dos partes es gramática, no juicio; resolver el nombre contra un catálogo cerrado es búsqueda, no generación. Ni una ni otra necesitan un modelo. Es lo que mantiene el ciclo bajo 1.500 ms y el costo del parse en cero.
- **Alternativas descartadas**: **LLM en la ruta caliente** — viola la Restricción 1, añade 500–2.000 ms y multiplica el costo por el número de turnos. **Expresiones regulares sueltas** — se vuelven inmantenibles al tercer caso.
- **Implementación MVP**: gramática con números en español (cardinales, decimales con "punto"/"coma"/"con"), diccionario de unidades con sinónimos y plurales, **rechazo explícito** de fraccionarios verbales ("medio", "un cuarto") por FR-1.9, y **resolución del caso "nombre con número dentro"** ("aceite 3 litros", "guantes talla 8"): la gramática prueba ambas segmentaciones y, si las dos producen un artículo plausible del catálogo, **presenta candidatos en vez de elegir**. Cobertura objetivo ≥ 90% de turnos.
- **Limitación conocida**: el 10% restante — frases mal formadas, correcciones a media frase, ruido — no lo resuelve. Y el nombre con número embebido es intrínsecamente ambiguo: se mitiga preguntando, no se elimina.
- **Señal de escalado**: cobertura del parser < 85% medida en producción.
- **Reemplazo previsto**: ese 10% escala a D-09; y los patrones nuevos que aparezcan se **añaden a la gramática**, no se dejan permanentemente en el LLM.

### D-09 · LLM de excepciones y Árbitro: `claude-opus-5` vía OpenRouter

- **Elegida**: tres usos separados y ninguno en la ruta caliente. **(a)** El ~10% de turnos que la gramática no resuelve. **(b)** El **Árbitro**: cuando dos rondas se contradicen o una discrepancia necesita explicación, redacta el caso para el Auditor. **(c)** Nada más. Modelo `claude-opus-5` ($5/1M entrada, $25/1M salida), detrás de la interfaz `ProveedorDeInterpretacion`.
- **Razón**: son los dos puntos donde el problema deja de ser una condición y pasa a ser interpretación — exactamente el límite que la Restricción 1 traza. El Árbitro **no decide** quién tiene razón (FR-3.4 lo prohíbe): ordena la evidencia para que el Auditor decida. La salida del uso (a) **siempre** vuelve a pasar por la validación determinista antes de guardarse.
- **Alternativas descartadas**: **un modelo más barato para el parse** — es la segunda palanca de costo y vale la pena medirla, pero a 10% de los turnos el gasto ya es bajo y el costo de un parse equivocado es un conteo equivocado. **Modelo en la ruta caliente** — Restricción 1.
- **Implementación MVP**: salida estructurada con esquema estricto; `effort: "low"` para el parse de excepción, `high` para el Árbitro; cacheo de prompt (D-12).
- **Limitación conocida**: dependencia de un proveedor externo con latencia variable.
- **Señal de escalado**: excepciones > 15% de turnos, o costo LLM > 25% del total.
- **Reemplazo previsto**: ampliar la gramática (D-08) para absorber los patrones frecuentes — la solución correcta es que el LLM **haga menos**, no que sea más barato.

### D-10 · Modo consulta del supervisor: Grok Voice Agent

- **Elegida**: `wss://api.x.ai/v1/realtime` (~$0,05/min) para el modo conversacional del supervisor: preguntar por el estado del inventario en voz natural.
- **Razón**: es un caso de uso distinto — conversación abierta y de bajo volumen, no captura estructurada. Un agente de voz nativo hace ahí lo que un ciclo STT→parse→TTS hace mal.
- **Alternativas descartadas**: reutilizar el flujo de captura (está optimizado para lo contrario); no ofrecer el modo (pierde la palanca de adopción del supervisor).
- **Implementación MVP**: solo rol Administrador/Supervisor; **solo lectura** — no puede alterar conteos; el agente consulta la API con el token del supervisor.
- **Limitación conocida**: $0,05/min es caro; a volumen de operario sería inviable. Por eso está acotado a supervisores.
- **Señal de escalado**: > 400 min/mes.
- **Reemplazo previsto**: ciclo propio Deepgram + `claude-opus-5` + TTS, que ya está construido para el resto del sistema.
- **⚠️ A verificar**: endpoint y precio provienen del brief; confirmar contra la documentación vigente antes de comprometerlos en el presupuesto.

### D-11 · Transporte WebRTC + Silero VAD en el navegador

- **Elegida**: WebRTC como transporte del audio y Silero VAD ejecutándose en el dispositivo para decidir qué se transmite.
- **Razón**: WebRTC trae control de jitter, cancelación de eco y supresión de ruido de la propia plataforma — en bodega eso no es un lujo. El VAD local es a la vez una decisión de **costo** (solo se factura el audio con voz: recorta el gasto de STT a menos de un tercio) y de **privacidad** (el micrófono no transmite conversaciones ajenas; Principio V y minimización de datos).
- **Alternativas descartadas**: **WebSocket con PCM crudo** — más simple pero sin manejo de jitter ni supresión de ruido, y transmite todo. **VAD en el servidor** — llega tarde: el audio ya se transmitió y ya se pagó.
- **Implementación MVP**: Silero VAD en ONNX Runtime Web (WASM), cargado diferido (D-04); *push-to-talk* como camino alterno si el VAD no carga.
- **Limitación conocida**: ~1.8 MB de WASM y algo de CPU en dispositivos viejos.
- **Señal de escalado**: dispositivos donde el VAD consuma > 15% de CPU sostenido.
- **Reemplazo previsto**: *push-to-talk* permanente en ese parque de dispositivos. Funciona, solo es menos cómodo.

### D-12 · Readback por `speechSynthesis`

- **Elegida**: la voz del navegador (`speechSynthesis`) para decir el artículo y confirmar el registro.
- **Razón**: FR-1.8 exige confirmación **auditiva** y el operario trabaja con las manos ocupadas. Es gratis, funciona sin red y no añade latencia de red al ciclo.
- **Alternativas descartadas**: **TTS en la nube** — mejor voz, pero costo por uso y latencia en el punto donde el presupuesto de 1.500 ms está más ajustado.
- **Implementación MVP**: voz `es-CO`/`es-419` con reserva; confirmación visual **siempre** presente en paralelo (nunca solo audio, por accesibilidad).
- **Limitación conocida**: la calidad de voz varía entre dispositivos.
- **Señal de escalado**: quejas de inteligibilidad en el parque real.
- **Reemplazo previsto**: TTS en la nube **pregenerado y cacheado** por artículo — el catálogo es finito, así que se sintetiza una vez y se reproduce desde caché.

---

## Bloque C — Datos, durabilidad y caché

### D-13 · PostgreSQL 17 + Drizzle, modelo *append-only*

- **Elegida**: PostgreSQL. Drizzle como capa de acceso y migraciones. Las tablas de conteo son de **solo inserción**, con `UPDATE` y `DELETE` **revocados** para el rol de la aplicación.
- **Razón**: D2 impone inmutabilidad — *"no se puede actualizar en el mismo, porque perderíamos la contabilidad de las rondas"*. Eso convierte el histórico en el modelo de datos, no en un adorno. La inmutabilidad **no se confía a la capa de aplicación**: se revoca el permiso en el motor, para que un `UPDATE` por descuido falle en producción y no en la revisión de código. Postgres además da transacciones reales, que el patrón outbox (D-14) necesita de forma no negociable.
- **Alternativas descartadas**: **Prisma** — abstrae justo el SQL que un modelo append-only necesita controlar (índices parciales sobre el registro vigente, restricciones de exclusión). **Event sourcing completo** — la Constitución cierra con *"ante la duda, gana la opción más simple"*; append-only + proyección basta y cuesta mucho menos operar.
- **Implementación MVP**: una instancia gestionada, sin réplicas de lectura.
- **Limitación conocida**: la tabla de registros crece sin límite por diseño.
- **Señal de escalado**: > 50 M de registros o p95 de consulta > 100 ms.
- **Reemplazo previsto**: particionado por rango de fecha e inventarios cerrados a almacenamiento frío. El modelo no cambia.

### D-14 · Eventos: outbox transaccional + pg-boss

- **Elegida**: interfaz `EventBus`; tabla `outbox` escrita **en la misma transacción** que el dato que origina el evento; despacho con pg-boss (cola sobre Postgres).
- **Razón**: el Principio IV es literal — *"el evento y el dato que lo origina DEBEN escribirse en la misma transacción"*. pg-boss usa la misma base, así que el despacho hereda la transacción y **no hay una segunda infraestructura que pueda quedar desincronizada**. Los consumidores son idempotentes por `event_id`.
- **Alternativas descartadas**: **Kafka/RabbitMQ** — complejidad no justificada en el MVP; la Constitución exige justificar toda complejidad contra la alternativa simple. **BullMQ sobre Redis** — la cola quedaría fuera de la transacción del dato: precisamente lo que el Principio IV prohíbe. **`EventEmitter` sin outbox** — viola el Principio IV de forma directa.
- **Implementación MVP**: despachador en el mismo proceso, con `FOR UPDATE SKIP LOCKED`.
- **Limitación conocida**: rendimiento de cola limitado por Postgres (suficiente de sobra para este volumen).
- **Señal de escalado**: > 1.000 eventos/s o necesidad de consumidores fuera del sistema.
- **Reemplazo previsto**: un *relay* que lee el outbox y publica a un bus externo. Los dominios no se enteran.

### D-15 · Durabilidad en el dispositivo: IndexedDB como WAL

- **Elegida**: cada registro se escribe en IndexedDB (Dexie) con clave de idempotencia UUIDv7 generada en el cliente, **antes** de intentar el envío. La confirmación al Operador se emite cuando el dato es durable **localmente**.
- **Razón**: la Restricción 2 es textual — *"ningún dato confirmado al usuario puede perderse por una falla de red, y ningún reintento puede duplicarlo"*. IndexedDB opera como *write-ahead log*: se escribe, se confirma, y el envío es un detalle posterior. Es además lo que hace alcanzable el umbral de 1.500 ms, porque la confirmación no depende de la latencia de red.
- **Matiz deliberado y crítico**: la confirmación local dice *"quedó registrado"*, **no** *"el sistema validó tu conteo"*. La alerta de discrepancia es una decisión del servidor y llega después (FR-6.5, FR-6.7). Si la interfaz mezcla los dos momentos, el operario creerá aprobado un conteo que aún no lo está.
- **Alternativas descartadas**: **`localStorage`** — síncrono, sin transacciones, límite bajo. **Background Sync API como única garantía** — soporte desigual entre navegadores; se usa como oportunista, no como garantía.
- **Implementación MVP**: `INSERT … ON CONFLICT (clave_idempotencia) DO NOTHING` en el servidor. Los reintentos son seguros por construcción.
- **Limitación conocida**: si el usuario borra los datos del sitio con registros pendientes, se pierden.
- **Señal de escalado**: cola local > 500 registros pendientes de forma habitual.
- **Reemplazo previsto**: alerta al Operador y bloqueo de nuevos registros antes de aceptar lo que no se puede conservar (FR-6.6).

### D-16 · El choque entre encolar offline y que el sello sea del servidor

- **Elegida**: **dos tiempos por registro, ambos almacenados**. `capturado_en` lo fija el cliente contra una referencia sincronizada con el servidor al abrir la ronda (no el reloj del dispositivo); `recibido_en` lo fija el servidor y es el sello autoritativo. Se guarda además el `desfase_reloj_ms` medido en la sincronización.
- **Razón**: es una contradicción real, no un detalle. FR-6.8 exige anclar el momento a una referencia confiable, pero un registro creado sin red **no puede** tener sello de servidor en el instante en que ocurre. Un solo campo obliga a mentir: o se usa el reloj del dispositivo (manipulable, desajustado) o se falsea el momento del conteo como el de su llegada — lo que en una auditoría es peor. Con dos campos, el orden dentro de la ronda es del cliente (monótono, correcto aunque no haya red) y la autoridad legal es del servidor.
- **Alternativas descartadas**: **solo reloj del cliente** — no auditable. **Solo sello del servidor** — pierde el orden real del conteo y agrupa en el instante de sincronización todo lo capturado durante un corte.
- **Implementación MVP**: número de secuencia monótono por ronda, además de los dos tiempos.
- **Limitación conocida**: un dispositivo con desfase grande produce `capturado_en` sesgado; queda registrado y visible en la traza.
- **Señal de escalado**: desfase > 5 min observado con frecuencia.
- **Reemplazo previsto**: rechazar la apertura de ronda hasta resincronizar el reloj.

### D-17 · Cacheo de prompts: split estático/dinámico con TTL de 1 h

- **Elegida**: el playbook heredado de un proyecto anterior, aplicado íntegro. Todo prompt se parte en un **bloque estático** (instrucciones, catálogo de la bodega, gramática de unidades, ejemplos) marcado con `cache_control` TTL 1 h, y un **bloque dinámico** al final (el turno concreto).
- **Razón**: el ahorro medido en producción con este patrón fue del **74%**. Con `claude-opus-5` la lectura de caché cuesta ~0,1× la entrada y el mínimo cacheable bajó a **512 tokens** (la mitad que en Opus 4.8), así que incluso prompts modestos entran. El catálogo de una bodega es el bloque estático ideal: idéntico durante toda la jornada, distinto entre bodegas.
- **Alternativas descartadas**: **sin caché** — paga entrada completa en cada llamada. **TTL de 5 min** — escritura más barata (1,25× vs 2×), pero una jornada de conteo tiene huecos mayores a 5 min y el caché se enfría; a 1 h el punto de equilibrio son 3 llamadas y aquí hay miles.
- **Implementación MVP**: orden de render `tools → system → messages` con el catálogo al final del bloque estático; **prohibido** interpolar hora, UUID o ID de sesión antes del punto de corte — invalidaría todo el prefijo.
- **Limitación conocida**: cambiar el catálogo de una bodega invalida su caché.
- **Señal de escalado**: `cache_read_input_tokens` en cero de forma sostenida (síntoma de un invalidador silencioso).
- **Reemplazo previsto**: auditar el prefijo renderizado byte a byte entre dos peticiones para hallar el invalidador.

### D-18 · Redis como caché de aplicación

- **Elegida**: Redis para catálogo por bodega, saldos esperados, tolerancias de merma vigentes y sesiones de rate-limit.
- **Razón**: el objetivo de p95 < 200 ms con 500 concurrentes se gana evitando ir a Postgres por datos que casi nunca cambian. El catálogo de una bodega es de lectura intensiva y escritura casi nula: el caso de libro.
- **Alternativas descartadas**: **solo caché en memoria del proceso** — incompatible con despliegues stateless multi-instancia (cada réplica tendría una versión distinta de la tolerancia vigente). **Sin caché** — carga innecesaria sobre Postgres.
- **Implementación MVP**: instancia gestionada; TTL 15 min con invalidación explícita al cambiar configuración; **el saldo esperado se cachea en el servidor y jamás se sirve al cliente** (FR-1.18).
- **Limitación conocida**: una invalidación perdida sirve tolerancia vieja por hasta 15 min. Mitigado porque FR-8.2 exige aplicar la tolerancia **vigente al momento del conteo**, que se resuelve y se persiste con el registro.
- **Señal de escalado**: tasa de acierto < 80%, o memoria al límite.
- **Reemplazo previsto**: Redis en clúster.

### D-19 · Búsqueda de catálogo: `pg_trgm`, no RAG

- **Elegida**: `pg_trgm` (similitud por trigramas) con normalización de texto y distancia de edición, devolviendo N candidatos con puntaje. Si el mejor no supera el umbral o dos empatan, **el sistema no elige**: pregunta (FR-1.11).
- **Razón**: buscar en un catálogo cerrado de unos miles de artículos es un problema de búsqueda, no de recuperación semántica. La Restricción 1 exige determinismo, y `pg_trgm` ya está en la base que tenemos: cero infraestructura nueva. **Con captura libre (D-05/D7) esta es la ruta caliente**: se ejecuta en cada turno de conteo, no solo en fantasmas y búsqueda manual. Por eso su latencia (<5 ms) y su calidad de resolución son ahora críticas.
- **Alternativas descartadas**: **RAG / embeddings + base vectorial** — mejor recall en catálogos enormes, pero añade infraestructura, costo de embeddings y no determinismo, para un catálogo que no lo necesita. **LLM resolviendo el nombre** — elegir de un conjunto cerrado es selección, no generación; la Restricción 1 lo prohíbe.
- **Implementación MVP**: índice GIN sobre nombre normalizado; **dos umbrales**, uno de aceptación y uno de **margen** entre el primer y el segundo candidato — si el margen es estrecho se pregunta aunque el primero pase el umbral (FR-1.27); tabla de **sinónimos y alias por bodega**, porque la gente no llama a las cosas como las llama el ERP; caché del catálogo de la bodega en Redis (D-18).
- **Resolución en dos capas, y la primera es local.** El catálogo de la bodega se descarga al abrir la ronda y vive en el dispositivo (F-21); **no contiene el saldo esperado**, así que cachearlo no toca el conteo ciego. La primera resolución corre ahí, en milisegundos y **sin red** — sin eso, un microcorte de Wi-Fi dejaría al Operador sin poder contar, contra la Historia 6 y la Restricción 5. El servidor **re-resuelve** al recibir el registro y es la autoridad: si difiere de la resolución local, el registro **no se corrige en silencio**, se marca para el Auditor. `origen_nombre` conserva por cuál vía se resolvió.
- **Limitación conocida**: no captura sinónimos semánticos ("gaseosa" vs "refresco") salvo que estén en la tabla de alias.
- **Señal de escalado**: desambiguación manual > 10% de los turnos de conteo. La mejora barata es poblar los alias, no cambiar el algoritmo.
- **Reemplazo previsto**: **RAG queda reservado exclusivamente al modo consulta del supervisor** (D-10), y si se implementa, con el patrón de recuperación en dos etapas (recuperar amplio, reordenar y filtrar antes de entregar al modelo). Nunca en la ruta de captura.

---

## Bloque D — Seguridad, operación y contratos

### D-20 · Identidad: argon2id + cookie `httpOnly`, sin estado en el servidor

- **Elegida**: `ProveedorDeIdentidad` como interfaz; implementación MVP contra padrón propio con argon2id; sesión en cookie `httpOnly` + `Secure` + `SameSite=Strict`, firmada, **sin sesión en memoria del servidor**.
- **Razón**: D3 y el Principio V (usuario y contraseña, argon2id o bcrypt, prohibida la biometría por Ley 1581). Un token accesible por JavaScript es robable por XSS; la cookie `httpOnly` no. Y sin estado de sesión en el servidor, cualquier réplica atiende cualquier petición — que es lo que "stateless" significa en la práctica.
- **Alternativas descartadas**: **JWT en `localStorage`** — superficie de XSS innecesaria. **Sesión en memoria** — rompe el despliegue stateless. **Directorio institucional desde el MVP** — D3 lo descartó por dependencia de accesos corporativos.
- **Implementación MVP**: rol resuelto **siempre** en servidor desde la base (FR-1.2); el cliente recibe el rol solo para decidir qué pinta, jamás qué permite.
- **Limitación conocida**: revocar una sesión antes de su expiración exige una lista de revocación.
- **Señal de escalado**: requisito de cierre de sesión inmediato en todos los dispositivos.
- **Reemplazo previsto**: lista de revocación en Redis (D-18), consultada por `jti`.

### D-21 · Postura OWASP

- **Elegida**: OWASP ASVS nivel 2 como línea base, verificada en CI.
- **Razón**: "seguridad OWASP" no es verificable; un nivel de ASVS sí. Mapeo al Top 10: **A01** autorización por endpoint y por rol, negada por defecto; **A02** TLS en tránsito, argon2id en reposo, sin secretos en el cliente; **A03** consultas parametrizadas por Drizzle y validación Zod en toda frontera; **A04** el conteo ciego es una decisión de diseño verificada por test (SC-1.3); **A05** CSP estricta sin `unsafe-inline`, cabeceras de seguridad, CORS cerrado; **A07** argon2id, límite de intentos, sin enumeración de usuarios; **A08** contratos firmados y dependencias fijadas por lockfile; **A09** auditoría append-only ya es requisito de negocio; **A10** el token efímero de Deepgram (D-07) acotado en alcance y vida.
- **Alternativas descartadas**: auditoría manual al final (encuentra tarde y caro).
- **Implementación MVP**: `npm audit` + Semgrep + ZAP baseline en CI; secretos en gestor, nunca en repositorio.
- **Limitación conocida**: ASVS L2 no cubre amenazas específicas de dispositivo físico compartido.
- **Señal de escalado**: manejo de datos personales más allá del mínimo, o exigencia de certificación.
- **Reemplazo previsto**: ASVS L3 y pentest externo.

### D-22 · Contratos: Zod como fuente única, OpenAPI derivado

- **Elegida**: `packages/contracts` define esquemas Zod; de ahí se derivan tipos de TypeScript, validación en runtime del servidor y el documento OpenAPI.
- **Razón**: el Principio VI prohíbe redefinir a mano en el cliente un tipo que ya existe en el servidor, y exige validar en runtime todo lo que cruza una frontera de confianza. Zod satisface ambas con una sola declaración.
- **Restricción explícita**: `contracts` contiene **solo** esquemas, tipos y constantes. **Prohibido** que acumule reglas de negocio — sería la "capa de utilidades compartidas" que el Principio III veta.
- **Alternativas descartadas**: **OpenAPI a mano** — dos fuentes de verdad que divergen. **tRPC** — acopla el contrato a un cliente TypeScript, contra el Principio I (la API debe ser consumible por clientes que no son este frontend).
- **Implementación MVP**: `zod-to-openapi`; el documento se publica y se versiona.
- **Limitación conocida**: consumidores no-TypeScript dependen del OpenAPI generado.
- **Señal de escalado**: un tercero integra contra la API.
- **Reemplazo previsto**: publicar el OpenAPI como artefacto versionado con pruebas de compatibilidad.

### D-23 · Observabilidad: latencia por etapa

- **Elegida**: cada etapa del ciclo emite su latencia por separado — VAD, STT, parse, escritura local, confirmación, envío, validación en servidor — con trazas OpenTelemetry y percentiles.
- **Razón**: el Principio VII exige que *"cada etapa emita su latencia por separado para poder atribuir una degradación"*. Un número agregado dice que algo se puso lento; no dice qué. Con 500 concurrentes y un presupuesto de 1.500 ms repartido entre siete etapas, sin atribución no hay diagnóstico.
- **Alternativas descartadas**: solo métrica extremo a extremo (no permite atribuir); logs sin trazas (no correlacionan).
- **Implementación MVP**: OpenTelemetry → colector; presupuesto por etapa verificado en CI; **prohibido** registrar audio, credenciales o datos personales (NFR-005).
- **Limitación conocida**: costo de instrumentación en el cliente.
- **Señal de escalado**: volumen de trazas que encarezca el almacenamiento.
- **Reemplazo previsto**: muestreo por cabecera, conservando el 100% de los turnos con error.

### D-24 · Integración ERP: puerto con adaptador simulado

- **Elegida**: `PuertoInventarioERP` con dos adaptadores — real contra Oracle Fusion Cloud Inventory Management y simulado que registra los envíos localmente. El MVP se demuestra con el simulado.
- **Razón**: la Restricción 5 exige aislar y degradar toda dependencia externa, y el acceso a Oracle no está garantizado durante el desarrollo. Aislarlo evita que su ausencia bloquee todo lo demás.
- **Alternativas descartadas**: integrar directo (bloquea el avance del MVP en una dependencia que no controlamos).
- **Implementación MVP**: idempotencia por referencia única derivada de bodega + cierre de inventario (FR-7.4); reintento con backoff.
- **Limitación conocida**: el adaptador simulado no revela las particularidades reales de Oracle.
- **Señal de escalado**: acceso concedido al entorno de pruebas de Oracle.
- **Reemplazo previsto**: adaptador real detrás del mismo puerto, con pruebas de contrato.

### D-25 · Dónde vive el backend: EC2, no Lambda

- **Elegida**: **EC2** para la API NestJS y el worker de pg-boss (Docker Compose en el MVP; ASG + ALB en Terraform diseñado pero **no construido** para el demo). Frontend en **S3 + CloudFront** — es un bundle estático, no un servidor. **Lambda** reservada al trabajo por evento y aislado: forense sobre el archivo del cliente disparado por S3, exportaciones pesadas, procesamiento diferido del audio de evidencia. Postgres y Redis gestionados (RDS + ElastiCache).
- **Razón**, en orden de peso:
  **(1) pg-boss necesita un proceso residente.** El despachador del outbox *es* el bus de eventos (Principio IV) y hace polling con `FOR UPDATE SKIP LOCKED`. Lambda no sostiene un consumidor de cola vivo; habría que reemplazarlo por invocaciones programadas y perder la propiedad que D-14 compró.
  **(2) Arranque en frío contra p95 < 200 ms.** NestJS tarda ~300 ms en levantar (D-02). Un arranque en frío se come el presupuesto entero del Principio VII.
  **(3) Conexiones a Postgres.** Lambda con Postgres exige RDS Proxy: una pieza más, con su latencia y su costo, para no ganar nada a ~35 req/s reales.
- **Alternativas descartadas**: **Todo en Lambda** — el argumento a favor es real y honesto: el conteo es una ráfaga mensual predecible y el resto del mes la flota está ociosa, que es exactamente donde pagar por uso gana. Pero contra ~$12/mes de un `t4g.small`, el ahorro no compensa las tres consecuencias de arriba. **Fargate** — descartado si D-07 se resolviera por B: WebRTC necesitaría rango de puertos UDP. Con D-07-A el audio no toca nuestro servidor y Fargate volvería a ser viable; se deja como reemplazo previsto, no como elección. **Kubernetes** — la Constitución exige justificar toda complejidad contra la alternativa simple; dos contenedores no la justifican.
- **Implementación MVP**: una instancia EC2 con Docker Compose (API + worker), secretos en SSM Parameter Store, despliegue por reemplazo. Es el mismo patrón operado en producción en otros sistemas del equipo, así que no hay curva de aprendizaje.
- **Limitación conocida**: una sola instancia es un punto único de falla y no absorbe el pico sin intervención.
- **Señal de escalado**: CPU > 70% sostenida durante la ventana de conteo, o p95 de API acercándose a 200 ms.
- **Reemplazo previsto**: activar el ASG ya escrito en Terraform. Como la API es stateless (D-07-A, D-18, D-20), escalar es añadir instancias detrás del ALB — sin sticky sessions, sin *draining*. Y como el pico es **predecible** (el inventario es mensual y programado), la política correcta es *pre-warm* programado con seguimiento de objetivo como red de seguridad, no escalado puramente reactivo: nadie arranca diez instancias en los minutos en que entran 350 operarios.

---

## Doce descartes, con su argumento

| # | Descartado | Argumento |
|---|---|---|
| 1 | **Web Speech API** | Español inconsistente entre navegadores, sin formateo de numerales, sin fin de turno, sin self-host. |
| 2 | **Whisper self-hosted** | Es batch: sin fin de turno y con latencia de segundos, incompatible con el ciclo de 1.500 ms. |
| 3 | **Backend en Python** | *Rectificación mía*: duplica los contratos y rompe el Principio VI (tipado único en todo el stack). |
| 4 | **Next.js** | Invita a alojar lógica de negocio dentro del frontend — la frontera que el Principio II declara indivisible. |
| 5 | **LLM en la ruta caliente** | Viola la Restricción 1, añade 500–2.000 ms y multiplica el costo por cada turno. |
| 6 | **RAG para el catálogo** | Buscar en un catálogo cerrado es búsqueda, no recuperación semántica. `pg_trgm` ya está en la base. |
| 7 | **Kafka / RabbitMQ** | Complejidad no justificada; el outbox sobre Postgres cumple el Principio IV con una sola infraestructura. |
| 8 | **BullMQ sobre Redis** | La cola quedaría fuera de la transacción del dato — exactamente lo que el Principio IV prohíbe. |
| 9 | **Event sourcing completo** | Append-only con proyección satisface D2 y cuesta una fracción de operar. |
| 10 | **Prisma** | Abstrae el SQL que un modelo append-only necesita controlar. |
| 11 | **JWT en `localStorage`** | Robable por XSS; la cookie `httpOnly` da lo mismo sin la superficie. |
| 12 | **Sticky sessions** | Atan un usuario a una instancia y convierten cada despliegue en un *draining* de una hora. Evitarlas es la razón de D-07-A. |

## Cinco "no" argumentados

1. **No** decide un modelo de lenguaje si un dato es válido. Interpreta entrada ambigua; nunca juzga validez. *(Restricción 1)*
2. **No** viaja el saldo esperado al dispositivo del Operador, ni cacheado, ni derivado, ni inferible del tiempo de respuesta. *(FR-1.18, SC-1.3)*
3. **No** existe `UPDATE` ni `DELETE` sobre las tablas de conteo — revocado en el motor, no confiado a la aplicación. *(D2, FR-1.13)*
4. **No** se guarda audio crudo en logs ni se envía a un tercero fuera del canal de transcripción. *(Principio V, NFR-005, Ley 1581)*
5. **No** hay estado de sesión en el servidor. Cualquier réplica atiende cualquier petición, siempre. *(Objetivo de despliegue stateless)*

---

## Costos

**Precios unitarios confirmados**: `claude-opus-5` = $5,00 / 1M tokens de entrada, $25,00 / 1M de salida; lectura de caché ≈ 0,1×; escritura de caché 2× con TTL de 1 h; mínimo cacheable 512 tokens.
**Precios unitarios por verificar** ⚠️: tarifa por minuto de Deepgram Flux Multilingual, tarifa de Grok Voice Agent ($0,05/min según el brief) y el recargo de OpenRouter. Vienen del brief, no de documentación consultada.

**Modelo por unidad de trabajo** — el costo escala con **ítems contados**, no con usuarios:

| Concepto | Cálculo | Por ítem |
|---|---|---|
| STT | ~18 s de voz efectiva (post-VAD) por ítem — el Operador pronuncia también el nombre (D-05/D7) | ~$0,0029 |
| Parse LLM | 10% de turnos × (1.200 tok cacheados + 300 nuevos + 120 salida) | ~$0,0005 |
| Resolución de nombre | `pg_trgm`, en la base que ya se paga | $0 |
| Árbitro | 3% de ítems × llamada más pesada | ~$0,0003 |
| **Variable total** | | **~$0,0037** |

| Volumen mensual | Variable | Infraestructura fija | **Total** |
|---|---|---|---|
| 100.000 ítems | $370 | $150 | **~$520** |
| **200.000 ítems** | **$740** | **$150** | **~$890** |
| 300.000 ítems | $1.110 | $150 | **~$1.260** |

**El costo subió ~25% al revocar D6.** Con trabajo dirigido el turno era solo la cantidad (~12 s de audio, ~$0,0027 por ítem, ~$690 al mes a 200.000 ítems). Con captura libre el Operador pronuncia también el nombre y el audio por ítem crece ~50%; como el STT es la mitad de la factura, el total sube ~25%. Es el precio de que el Operador dicte su recorrido en vez de seguir el del sistema, y el negocio lo aceptó a cambio de velocidad de campo. **La resolución del nombre no aporta costo**: se hace con `pg_trgm` sobre la base que ya se paga, no con un modelo.

Infraestructura fija: EC2 para API y worker, Postgres gestionado, Redis, S3 y CloudFront (D-25). Es baja porque la arquitectura es stateless y el pico real de API son ~35 req/s, no 500 — el navegador habla con Deepgram directo (D-07-A) y solo envía texto.

**El volumen no se duplica.** D5 confirma un artículo con **una** ronda de conteo ciego, así que los ~200.000 ítems/mes corresponden a un recorrido por bodega. La versión anterior de D5 exigía dos recorridos y habría llevado el variable a ~$1.080/mes.

**Palancas, en orden de rendimiento:**

1. **Proveedor de STT (~50% del gasto).** Aquí está el dinero. Bajar el ratio de VAD, negociar tarifa, o self-hostear Flux mueve la aguja más que cualquier otra cosa.
2. **Modelo del parse (~25%).** Segunda palanca. Pero la mejora correcta no es un modelo más barato: es **ampliar la gramática** (D-08) para que el LLM se invoque menos.
3. **Infraestructura (~20%).** La menor, y la que menos vale la pena optimizar.

**El lenguaje del backend es económicamente irrelevante** — es exactamente donde la discusión suele irse y donde no hay dinero. Cambiar Node por Go ahorraría una fracción de un punto porcentual del total.

---

## Sin `NEEDS CLARIFICATION` pendientes

Las decisiones de negocio se cerraron en `spec.md` (D1–D6). Queda **una decisión técnica abierta a propósito**: **D-07**, el punto de conexión de Deepgram. Está recomendada (opción A) y el plan está escrito asumiéndola; conmutar a B afecta únicamente al despliegue del backend y a la interfaz `ProveedorDeVoz`, no a los dominios.
