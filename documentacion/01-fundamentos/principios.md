> Nota: `SPEC.md`, citado a lo largo de este documento, es
> [el encargo del cliente](./el-encargo-del-cliente.md).

# Constitución del Proyecto
## Captura Inteligente de Inventarios — Colsubsidio

**Versión:** 1.0.0 · **Ratificada:** 2026-07-24 · **Última enmienda:** 2026-07-24

Este documento establece los **principios no negociables** que gobiernan toda especificación, plan, tarea y decisión de implementación del proyecto. Ninguna fase avanza sin cumplirlos. Ante conflicto entre este documento y cualquier otro artefacto (excepto `SPEC.md`, ver Principio IX), **prevalece esta Constitución**.

---

## Principios

### I. Arquitectura Platform-First

La solución **DEBE** construirse como plataforma base reutilizable, no como aplicación de un solo propósito.

- La API **DEBE** ser el único punto de acceso a la lógica de negocio y **DEBE** ser consumible por clientes distintos al frontend de este proyecto.
- Ningún contrato de API **PUEDE** asumir características del cliente web actual (tamaño de pantalla, capacidad de voz, navegador).
- Los conceptos del dominio **DEBEN** modelarse de forma genérica (`conteo`, `ubicación`, `discrepancia`), no atados a la operación de hoteles y parques.
- Toda funcionalidad expuesta en la UI **DEBE** existir primero como endpoint documentado.

*Fundamento:* el sistema es la base de futuras operaciones logísticas y físicas de Colsubsidio. Lo que se construya acoplado al caso de uso actual habrá que reescribirlo.

### II. Separación Estricta Web/API

Frontend y backend **DEBEN** estar completamente desacoplados.

- **PROHIBIDO** ejecutar lógica de negocio, validación de reglas o cruce de datos en el cliente.
- El cliente **NO PUEDE** conocer el Saldo Disponible (`SD`), las tolerancias de merma ni el resultado de la comparación antes de que el servidor lo decida. La comparación ocurre exclusivamente en el servidor (`SPEC.md` §4.2).
- El cliente **ES** responsable únicamente de: capturar entrada, renderizar estado y garantizar durabilidad local (ver Restricción Técnica 2).
- Frontend y backend **DEBEN** poder desplegarse de forma independiente.

*Fundamento:* el conteo ciego solo es ciego si el dato que debe ocultarse nunca viaja al dispositivo. Es un requisito de integridad, no de arquitectura.

### III. Módulos de Dominio Aislados

El backend **DEBE** seguir Domain-Driven Design con fronteras duras entre dominios.

- Dominios mínimos: `Identidad/Roles`, `Catálogo/Inventario`, `Captura`, `Auditoría`, `Integración/Exportación`.
- Un dominio **NO PUEDE** importar entidades internas ni acceder a las tablas de otro. La comunicación es por interfaz publicada o por evento.
- Cada dominio **DEBE** poder extraerse a servicio independiente sin refactorizar su lógica interna.
- **PROHIBIDA** una capa de "utilidades compartidas" que acumule reglas de negocio de varios dominios.

*Fundamento:* las fronteras se dibujan una sola vez, al principio. Extraer un módulo después es barato solo si la frontera ya existía.

### IV. Comunicación por Eventos

Los módulos **DEBEN** comunicarse preferentemente mediante eventos de dominio.

- Eventos mínimos: `ConteoRegistrado`, `DiscrepanciaDetectada`, `ProductoFantasmaRegistrado`, `ReconteoRegistrado`, `InventarioCerrado`.
- El evento y el dato que lo origina **DEBEN** escribirse en la **misma transacción de base de datos** (patrón *outbox*). **PROHIBIDO** emitir un evento fuera de la transacción que persiste su causa.
- Los consumidores **DEBEN** ser idempotentes: recibir el mismo evento dos veces no puede producir dos efectos.
- El transporte de eventos **DEBE** estar detrás de una interfaz. Para el MVP es *in-process* + tabla `outbox`; el reemplazo por un bus externo no puede requerir cambios en los dominios.

*Fundamento:* si el conteo se guarda y el evento no se emite (o al revés), el sistema queda inconsistente sin señal de error. La atomicidad es la única garantía real.

### V. Seguridad y Privacidad por Diseño

> ⚠️ **Ajuste respecto a la instrucción original.** La instrucción de trabajo pedía *"seguridad passwordless"*. `SPEC.md` §2 exige explícitamente **usuario y contraseña**. Por el Principio IX (el SPEC manda), este principio recoge la exigencia del SPEC. Si se quiere passwordless, **primero hay que enmendar el `SPEC.md`**, no esta Constitución.

- La autenticación **DEBE** ser por **usuario y contraseña** contra la base de datos institucional.
- El rol **DEBE** deducirse de la base de datos. **PROHIBIDO** que el usuario seleccione su propio rol en la interfaz (`SPEC.md` §2).
- **PROHIBIDO** el uso de biometría, autenticación sin contraseña y envío de códigos por SMS, por las implicaciones legales del tratamiento de datos personales sensibles bajo la Ley 1581 de 2012 (los datos biométricos son datos sensibles y exigen autorización previa, expresa y separada).
- Las contraseñas **DEBEN** almacenarse con un algoritmo de hashing con sal diseñado para contraseñas (argon2id o bcrypt). **PROHIBIDO** almacenarlas reversibles o con hash de propósito general.
- Todo dato de inventario **DEBE** transmitirse cifrado en tránsito (TLS).
- **PROHIBIDO** registrar en logs credenciales, tokens, audio crudo de operarios o datos personales identificables.
- Se **DEBE** aplicar minimización de datos: no se recolecta ni se conserva ningún dato personal que el proceso de inventario no requiera.

*Fundamento:* la privacidad es un requisito legal antes que técnico. Reducir la superficie de datos personales es la mitigación más barata y la única irreversible.

### VI. Tipado Completo

**DEBE** usarse tipado estricto (TypeScript) en todo el stack.

- `strict: true` en `tsconfig.json`, sin excepciones por archivo.
- **PROHIBIDO** el uso de `any`. Cuando el tipo es genuinamente desconocido se usa `unknown` con estrechamiento explícito.
- Los contratos de API **DEBEN** derivarse de un esquema único compartido entre frontend y backend. **PROHIBIDO** redefinir a mano en el cliente un tipo que ya existe en el servidor.
- Todo dato que cruza una frontera de confianza (petición HTTP, evento, archivo importado) **DEBE** validarse en tiempo de ejecución, no solo en compilación.

*Fundamento:* el tipo en compilación no protege del dato que llega de afuera. Ambas validaciones son necesarias y distintas.

### VII. Performance Medible

El rendimiento **DEBE** definirse como umbral verificable, no como aspiración.

- Endpoints de consulta y de escritura simple: **p95 < 200 ms**.
- Ciclo completo de registro de un ítem (fin de entrada → confirmación al usuario): **p95 < 1.500 ms**.
- Core Web Vitals **DEBEN** monitorearse en el frontend.
- Los umbrales **DEBEN** verificarse automáticamente. Una regresión que los supere **DEBE** fallar la validación, no generar un ticket.
- Cada etapa del ciclo de captura **DEBE** emitir su latencia por separado para poder atribuir una degradación.

*Fundamento:* "debe sentirse en tiempo real" no es verificable. Un número con percentil sí, y solo lo que se mide se sostiene.

### VIII. Mobile-First, PWA y Accesible

La solución **DEBE** ser una Web instalable como PWA, no una aplicación nativa.

- **DEBE** funcionar en cualquier navegador móvil de los dispositivos de la compañía (smartphones y tablets).
- **DEBE** ofrecer entrada por **voz y por texto** con paridad funcional completa (`SPEC.md` §3.1). Ninguna función puede existir solo por voz. La entrada por texto **DEBE** exigir verificación explícita en pantalla antes de guardar.
- **DEBE** cumplir WCAG 2.1 nivel AA: contraste alto, objetivos táctiles amplios, soporte de lector de pantalla, operable con una sola mano.
- **DEBE** confirmar de forma perceptible (visual **y** auditiva) cada registro exitoso.
- El Service Worker **DEBE** garantizar la continuidad ante microcortes de red (`SPEC.md` §3.1).

*Fundamento:* el operario trabaja de pie, con las manos ocupadas, con ruido y a veces con guantes. La accesibilidad aquí no es cumplimiento normativo: es la condición para que el sistema se use.

### IX. Desarrollo Guiado por Especificaciones

Ningún feature se implementa sin estar antes especificado y aprobado.

- **`SPEC.md` es la autoridad sobre el comportamiento del producto.** Ante conflicto entre el código, un plan técnico o esta Constitución y el `SPEC.md`, **manda el `SPEC.md`**.
- Todo cambio de comportamiento **DEBE** entrar primero como enmienda al `SPEC.md` y luego al plan. **PROHIBIDO** implementar primero y documentar después.
- Los supuestos por validar (`SPEC.md` §7) **DEBEN** marcarse explícitamente en el código y en los planes como supuestos, no tratarse como hechos.
- Toda ambigüedad detectada **DEBE** registrarse y resolverse con el cliente antes de codificarse. **PROHIBIDO** inventar datos de negocio (razón social, unidades, tolerancias, códigos de producto) para desbloquear el desarrollo.

*Fundamento:* el costo de una suposición equivocada se paga entero al final. Preguntar cuesta un día; adivinar cuesta el sprint.

---

## Restricciones Técnicas Adicionales

Son transversales, no pertenecen a un dominio y son igualmente no negociables.

**1. Verificación determinista sobre inferencia probabilística.**
Toda regla de validación, confirmación o alerta **DEBE** implementarse como código determinista. **PROHIBIDO** delegar a un modelo de lenguaje una regla que pueda expresarse como condición. Los modelos se usan para interpretar entrada ambigua, nunca para decidir si un dato es válido.

**2. Durabilidad antes que red.**
Todo registro de conteo **DEBE** persistirse localmente en el dispositivo **antes** de intentar su envío. Cada registro **DEBE** portar una clave de idempotencia generada en el cliente, y el servidor **DEBE** deduplicar por esa clave. Ningún dato confirmado al usuario puede perderse por una falla de red, y ningún reintento puede duplicarlo.

**3. Trazabilidad del origen.**
Todo registro **DEBE** almacenar cómo fue capturado (`voz` | `texto`), por quién, cuándo y en qué ubicación. Esta metadata es evidencia de auditoría, no telemetría opcional.

**4. Causa antes que ajuste.**
Ninguna discrepancia **PUEDE** cerrarse sin registrar su causa mediante un código de razón de un catálogo controlado. **PROHIBIDO** el ajuste sin causa.

**5. Dependencias externas aisladas y degradables.**
Todo proveedor externo (reconocimiento de voz, modelo de lenguaje, ERP) **DEBE** consumirse detrás de una interfaz propia con implementación alternativa. La degradación de un proveedor **DEBE** conmutar a un camino alterno; **PROHIBIDO** que deje al operario sin poder trabajar.

**6. Reproducibilidad.**
El esquema de base de datos **DEBE** evolucionar por migraciones versionadas. **DEBE** existir un comando que deje el sistema en un estado inicial conocido y reproducible.

---

## Gobernanza

**Autoridad.** Esta Constitución gobierna todos los artefactos del proyecto excepto el `SPEC.md`, que la supera en materia de comportamiento del producto (Principio IX).

**Enmiendas.** Toda enmienda **DEBE**: (a) documentarse con su fundamento, (b) aprobarse por el equipo, (c) incrementar la versión, (d) revisar los artefactos que dependían del principio modificado.

**Versionado semántico.**
- **MAYOR** — se elimina o redefine un principio de forma incompatible.
- **MENOR** — se agrega un principio o se expande materialmente uno existente.
- **PARCHE** — aclaración de redacción sin cambio de obligación.

**Cumplimiento.** Toda revisión de código y todo plan técnico **DEBEN** verificar conformidad. Una violación **DEBE** corregirse o justificarse explícitamente como excepción documentada, con su fecha de vencimiento. **PROHIBIDAS** las excepciones permanentes no documentadas.

**Complejidad.** Toda complejidad **DEBE** justificarse contra una alternativa más simple descartada. Ante la duda, gana la opción más simple que satisfaga el `SPEC.md`.
