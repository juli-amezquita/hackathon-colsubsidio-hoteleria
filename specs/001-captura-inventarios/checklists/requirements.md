# Checklist de Calidad de la Especificación

**Feature**: Captura Inteligente de Inventarios (MVP)
**Propósito**: Compuerta previa a la planeación técnica. Mientras un ítem esté sin marcar, **no se planifica tecnología ni se escribe código**.
**Creado**: 2026-07-24 · **Última verificación**: 2026-07-25
**Documento evaluado**: [spec.md](../spec.md)

---

## A. Calidad del contenido

- [x] **Sin marcos de trabajo ni tecnologías** — verificado por búsqueda automática de 30+ términos técnicos sobre el documento completo. Las únicas coincidencias fueron falsos positivos dentro de palabras en español ("resto", "vuelve"). La única tecnología nombrada es el sistema central de destino, que es un dato del cliente en `SPEC.md` §6, no una elección de diseño.
- [x] **Centrado en valor de usuario y necesidad de negocio** — cada historia abre con qué cambia para la persona que la usa.
- [x] **Legible por interlocutores no técnicos** — sin jerga de implementación; glosario en §2.
- [x] **Todas las secciones obligatorias completas**

## B. Estructura por historia

Las 8 historias cumplen las 7 secciones exigidas:

| # | Historia | P | Valor | GWT | Edge | Req. | Métricas | Sup./Dep. | Fuera alcance |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Conteo ciego en ronda propia (dictado libre) | P1 | ✅ | 13 | 12 | 27 | 8 | ✅ | ✅ |
| 2 | Validaciones y discrepancia | P2 | ✅ | 10 | 6 | 10 | 5 | ✅ | ✅ |
| 3 | Consolidación contra el saldo esperado | P3 | ✅ | 10 | 7 | 10 | 5 | ✅ | ✅ |
| 4 | Reconteo del Auditor | P4 | ✅ | 10 | 5 | 9 | 4 | ✅ | ✅ |
| 5 | Productos fantasma | P5 | ✅ | 5 | 3 | 6 | 3 | ✅ | ✅ |
| 6 | Continuidad ante pérdida de red | P6 | ✅ | 7 | 7 | 9 | 3 | ✅ | ✅ |
| 7 | Salida e integración | P7 | ✅ | 7 | 4 | 9 | 4 | ✅ | ✅ |
| 8 | Tolerancias de merma | P8 | ✅ | 6 | 3 | 5 | 3 | ✅ | ✅ |

**Totales**: 68 escenarios Given/When/Then · 47 edge cases · 85 requisitos verificables · 35 métricas de éxito.

- [x] Cada historia declara **valor para el usuario**
- [x] Cada historia declara **escenarios Given/When/Then**
- [x] Cada historia declara **edge cases**
- [x] Cada historia declara **requisitos verificables**
- [x] Cada historia declara **métricas de éxito**
- [x] Cada historia declara **supuestos y dependencias**
- [x] Cada historia declara **fuera de alcance**

## C. Independencia y priorización

- [x] **Historias priorizadas** P1 a P8, en orden de valor entregado
- [x] **Cada historia es probable de forma independiente** — cada una declara su *Prueba independiente*, ejecutable sin las historias posteriores
- [x] **Las dependencias entre historias son explícitas y solo hacia atrás** — ninguna historia depende de una de prioridad menor
- [x] **P1 sola constituye un producto viable** — reemplaza el papel aunque no exista validación, consolidación ni auditoría
- [x] **Frontera del MVP declarada** — P1 a P4 son el núcleo; P5 a P8 completan

## D. Completitud de requisitos

- [x] **No quedan marcadores [NEEDS CLARIFICATION]** — cero en el documento
- [x] **Ninguna ambigüedad de negocio abierta** — las 8 decisiones (D1 a D8) fueron respondidas por el negocio entre el 2026-07-24 y el 2026-07-25 y están documentadas en §3 con su consecuencia de alcance. D6 figura como **revocada**, con D7 vigente en su lugar
- [x] **Requisitos verificables e inequívocos** — 85 requisitos, todos en forma MUST / MUST NOT, cada uno comprobable por observación del sistema
- [x] **Métricas medibles** — 35 métricas con umbral numérico o con condición binaria verificable
- [x] **Métricas independientes de la tecnología** — expresadas como resultado observable, no como característica interna
- [x] **Escenarios de aceptación definidos** — 68 en formato Dado/Cuando/Entonces
- [x] **Edge cases identificados** — 47, incluidos los conflictivos: nombre de artículo que contiene un número, resolución local distinta de la del servidor, doble registro, rondas contradictorias, artículo sin cobertura, artículo sin saldo esperado, tolerancia en el límite exacto, reloj desajustado, almacenamiento agotado, Auditor que audita su propia ronda
- [x] **Alcance acotado** — fuera de alcance declarado por historia y globalmente en §6
- [x] **Supuestos y dependencias identificados** — por historia, más 7 supuestos globales y 7 dependencias globales
- [x] **Ningún supuesto disfrazado de hecho** — los supuestos van marcados como tales (§8 y por historia), conforme al Principio IX

## E. Conformidad con la Constitución v1.0.0

- [x] **I · Platform-First** — el dominio se describe en términos genéricos (bodega, ronda, conteo, discrepancia); §5 no contiene ningún concepto atado a hoteles o parques
- [x] **II · Separación estricta** — FR-1.18 y FR-2.5: el saldo esperado nunca alcanza el dispositivo del Operador y la validación ocurre fuera de él. SC-1.3 lo convierte en criterio verificable
- [x] **III · Módulos aislados** — las entidades de §5 se agrupan por frontera de dominio; la estructura de módulos corresponde al plan
- [x] **IV · Eventos** — los hitos del ciclo (registro, discrepancia, fantasma, cierre de ronda, consolidación, reconteo, cierre de inventario) están definidos como transiciones observables
- [x] **V · Seguridad y privacidad** — FR-1.1 y FR-1.2: usuario y contraseña con rol deducido de la base de datos, nunca elegido. Sin biometría ni datos personales fuera de los necesarios
- [x] **VI · Tipado completo** — no aplica a una especificación funcional; se verifica en el plan
- [x] **VII · Performance medible** — SC-1.2 fija umbral con percentil (95% en menos de 1,5 s), no una aspiración
- [x] **VIII · Mobile-first, accesible** — FR-1.19 y FR-1.20 (navegador móvil sin aplicación nativa, WCAG 2.1 AA, una sola mano); FR-1.6 paridad voz/texto; FR-1.8 confirmación visual y auditiva
- [x] **IX · Guiado por especificaciones** — cero ambigüedades abiertas; supuestos marcados como supuestos; ningún dato de negocio inventado
- [x] **R1 · Determinismo sobre inferencia** — FR-2.6: las reglas de validación no se delegan a un modelo de lenguaje. FR-1.22: la resolución del nombre dictado tampoco — es búsqueda sobre un catálogo cerrado, no generación
- [x] **R2 · Durabilidad antes que red** — FR-6.1 y FR-6.2: persistencia en el dispositivo previa al envío, con clave de idempotencia. FR-6.6 prohíbe confirmar lo que no se puede conservar
- [x] **R3 · Trazabilidad del origen** — FR-1.12: modo de captura, autor, momento y bodega en cada registro
- [x] **R4 · Causa antes que ajuste** — FR-4.4: ninguna discrepancia se cierra sin código de razón de catálogo controlado
- [x] **R5 · Dependencias degradables** — FR-1.21 (seguir por texto si la voz no está disponible), FR-6.9 (resolver el nombre sin red) y los edge cases de Historia 7 ante indisponibilidad del sistema central
- [x] **R6 · Reproducibilidad** — no aplica a la especificación; se verifica en el plan

## F. Preparación para la siguiente fase

- [x] Todo requisito funcional tiene criterio de aceptación asociado
- [x] Los escenarios cubren los flujos principales de cada rol: Operador, Auditor, Administrador
- [x] Las métricas de éxito son alcanzables y verificables sin conocer la implementación
- [x] Ningún detalle de implementación se filtró a la especificación

---

## Veredicto

**COMPUERTA ABIERTA.** Los 42 ítems del checklist pasan. No quedan ambigüedades de negocio pendientes.

La planeación técnica (`/speckit-plan`) queda habilitada.

---

## Notas de la verificación

1. **D5 fue enmendada el 2026-07-25 y el alcance bajó.** La versión original exigía **doble conteo obligatorio**: cada bodega recorrida por dos personas distintas, y un inventario con una sola ronda no podía cerrarse. El negocio la revocó. La regla vigente es que **la ceguera es la garantía**: como el Operador no puede consultar el saldo esperado (FR-1.18, verificado por SC-1.3 y por la prueba E2), una coincidencia con ese saldo no se pudo fabricar, y basta para confirmar. Una ronda más la verificación del Auditor da el aval. El sistema soporta rondas múltiples pero no las exige. **Consecuencia: se elimina un recorrido completo por bodega** y la Historia 3 pasa de comparar rondas entre sí a comparar cada conteo contra el saldo esperado.

2. **La decisión D2 impone un modelo de datos de solo-inserción.** Nada se actualiza en sitio; una corrección supersede al registro anterior y ambos permanecen. Es la restricción más fuerte del diseño y condiciona la fase de planeación por completo.

3. **Los dos supuestos que se habían marcado en Historia 3 quedaron resueltos por la enmienda de D5.** Ya no hace falta definir qué significa "rondas independientes" ni si la coincidencia entre rondas admite tolerancia: las rondas no se comparan entre sí. La única comparación con tolerancia es conteo contra saldo esperado, con la merma vigente al momento del conteo (FR-2.3, FR-8.2). Dos rondas que difieran en cualquier magnitud van al Auditor (FR-3.10).

4. **No se declaró meta de reducción frente al papel** (por ejemplo "40% menos tiempo") porque no existe línea base medida del proceso actual. Comprometerla habría exigido inventar un dato del negocio, que el Principio IX prohíbe. Debe medirse el proceso en papel antes de fijarla.

5. **Artefactos de tecnología rehechos.** Se habían redactado un `research.md` y un `plan.md` antes de que la compuerta estuviera abierta. Fueron **reescritos** contra esta versión de la especificación, no aparcados. *(Una versión anterior de esta nota afirmaba que existían en un directorio `_parked/`; ese directorio nunca se creó y la afirmación se corrigió el 2026-07-25.)*

6. **Enmienda del 2026-07-25.** Tres cambios entraron después de que la compuerta se abriera, todos por decisión del negocio, y están reflejados en `spec.md`: la Historia 1 se reescribió íntegra para D6 (trabajo dirigido) porque conservaba la redacción de D1; D5 pasó de doble conteo obligatorio a coincidencia con el saldo esperado; y el Auditor mantiene visibilidad total de las diferencias por ser orgánicamente independiente de quien contó. Los conteos de la tabla §B corresponden a esta versión.
