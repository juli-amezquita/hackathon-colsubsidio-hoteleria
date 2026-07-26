# Barrido de QA — 26 de julio de 2026

Seis auditorías independientes de solo lectura sobre la rama `integracion`, una por
dominio: conteo y gramática · consolidación y auditoría · plataforma e infraestructura ·
agente de voz · frontend · cableado y contratos.

Todo lo que sigue está verificado leyendo el código. Lo que no se pudo probar sin
levantar infraestructura va marcado **SOSPECHA**.

**Estado de la suite tras las correcciones: 318/318 en verde** (25 archivos, Postgres y
Redis reales), `tsc --noEmit` limpio en API y frontend, `next build` correcto.

---

## 1 · Corregido en este barrido

| # | Qué pasaba | Dónde |
|---|---|---|
| 1 | **El repositorio no compila en un clon limpio.** El `.gitignore` traía una plantilla de Python (`eggs/`, `sdist/`, `lib64/`) cuyo `lib/` se tragaba `frontend/lib/` entero: `api.ts`, `agente-voz.ts`, `presencia.ts`, `auditoria.ts`, `metricas.ts`. El cliente completo de la API estaba fuera de git. No se notaba porque `docker build` copia el árbol de trabajo | `.gitignore:58` |
| 2 | **Todo el UI de error del producto era invisible.** `text-destructive` y `bg-destructive` no existían como token; Tailwind omite en silencio la clase que no conoce. Los mensajes de fallo de sincronización, de cierre de inventario y de alerta de unidad salían en gris de texto normal, sin caja y sin color | `app/globals.css` |
| 3 | **«undefined artículos actualizados» al cerrar el inventario.** El cliente declaraba a mano `articulosActualizados`; el servidor devuelve `saldosActualizados`. Es el clímax del producto y el tipo escrito a mano impide que `tsc` lo vea | `lib/api.ts:382` |
| 4 | **Una ronda con un conteo sostenido por voz NO se podía cerrar jamás.** `pendiente_de_resolver` exige evidencia de audio para lo sostenido en modo voz, y el producto no graba audio en ningún punto. El operario sostenía, el servidor pedía un audio imposible de subir, y el cierre quedaba bloqueado para siempre. Sostener ahora viaja como texto — es pulsar un botón, no dictar | `lib/store.tsx:298` |
| 5 | **`1.500` se registraba como `1,5`.** Error de mil veces. El punto se trataba como separador decimal; en Colombia es de miles. Salía con `ok: true`, así que el sistema no preguntaba nada, y repetir la frase daba siempre el mismo resultado | `gramatica/numeros.ts:126`, `quantity-field.tsx:55` |
| 6 | **IDOR de bodega en toda la superficie de Auditor y Administrador.** Solo se comprobaba el rol, nunca la asignación: `GET /auditoria/bodegas/<otra-sede>/pendientes` devolvía 200 con saldos, y `POST /integracion/bodegas/<otra-sede>/cierre` dejaba **avalar el inventario ajeno y mover su tabla madre**. En todo el sistema solo dos sitios consultaban `usuario_bodega` | `platform/autorizacion/bodega.guard.ts` (nuevo) |
| 7 | **Un artículo podía salir duplicado en el CSV y enviarse dos veces al ERP.** `discrepancia` no tenía índice único sobre `(bodega_id, articulo_id)` y se abría con un `WHERE NOT EXISTS` de dos pasos; el despachador está diseñado para varias réplicas | `drizzle/0017` |
| 8 | **El diálogo de cierre prometía algo que el servidor rechaza:** «N artículos siguen sin resolver y entrarán como están» → 400. Además el modal se quedaba abierto al fallar y su propio fondo tapaba el error | `auditor/reporte/page.tsx` |
| 9 | `POST /rondas` era la única ruta con cuerpo sin validar de toda la API: `{}` daba 500 al abrir la ronda, el primer paso del flujo | `captura.controller.ts:38` |
| 10 | `GET /aprendizaje/propuestas?estado=xxx` entraba crudo a un `::estado_propuesta` → 500 con traza de Postgres | `aprendizaje.controller.ts:50` |
| 11 | El rol `supervisor` existía, podía hacer login, y luego recibía **403 en `GET /sesion`**: no se le restauraba la sesión al recargar ni podía cerrarla | `identidad.controller.ts:60,74` |

---

## 2 · Pendiente · ROMPE

### 2.1 · El Auditor no puede resolver un hallazgo, y uno solo bloquea el cierre para siempre
`app/auditor/verificar/page.tsx:173` · `lib/api.ts:288,297`

`if (!pendiente.articuloId) return` deja `caso` en `null` para un producto fantasma, y
todo el formulario de resolución vive dentro de `{caso && …}`. El Auditor ve una tarjeta
informativa y nada más.

`exigirInventarioAvalado` rechaza el cierre mientras haya cualquier discrepancia abierta,
incluidas las de fantasmas. **Un hallazgo sin resolver bloquea el inventario de esa bodega
de forma permanente.** `api.casoDeFantasma` y `api.resolverFantasma` existen y no los llama
nadie.

Se suma un desajuste de contrato: `CasoFantasma` en el cliente declara un envoltorio
`fantasma:{…}` que la respuesta real no tiene, y `candidatosCatalogo` donde el servidor
manda `candidatosDescartados`.

### 2.2 · El Operador puede borrar su propia alerta y cerrar sin responderla
`ronda.service.ts:362-412`

`cerrar()` recorre las `decisiones` sin comprobar que el artículo esté entre los
pendientes. Enviar `{articuloId: X, estado: 'no_contado'}` sobre un artículo con
`alerta_discrepancia` inserta una fila con secuencia mayor, que pasa a ser la vigente, y
`pendiente_de_resolver` deja de listarlo. La alerta nunca se respondió (FR-2.4, FR-2.8).

Daño colateral: el artículo pasa de `discrepancia` a `sin_cobertura` y el Auditor deja de
ver que alguien contó 60 contra un saldo de 100.

### 2.3 · La prueba de la ceguera puede quedarse sin una sola aserción
`slice1.e2e.spec.ts:111,139,156`

`unArticulo()` hace `SELECT … LIMIT 1` **sin `ORDER BY`**. Si la fila que sale no tiene
saldo esperado, el array `prohibidos` queda vacío y el bucle no corre ni una vez: queda
solo un regex de nombres de campo, que es justo lo que el comentario del propio test dice
que no basta. Es la prueba innegociable de FR-1.18.

### 2.4 · Cinco fallas de terreno en el dispositivo
`app/afiliado/conteo/page.tsx` · `lib/store.tsx`

- «Agregar a la lista» **no hace nada y no dice por qué** cuando el nombre no resuelve:
  `noResuelto` se calcula y no se pinta en ninguna parte (`:61,196`).
- Cerrar la ronda mientras la cola drena marca como `no_contado` lo que sí se contó:
  `drenar()` devuelve una promesa ya resuelta si hay otro drenado en curso (`:284,537`).
- Sesión caducada: la sesión persistida no se borra, el operario sigue «dentro», y cada
  registro responde 401 → se marca `rechazado` (irrecuperable) en vez de reintentable.
  Treinta conteos borrados sin un mensaje (`:188,315`).
- Cerrar sesión **no borra la cola**: en un teléfono compartido, los conteos pendientes del
  operario A se drenan con la cookie de B (`:363`).
- «Registrado.» sin registrar: el error solo se pinta dentro del bloque `phase === 'confirm'`,
  que nunca está activo cuando el panel del agente es visible.

---

## 3 · Pendiente · GRAVE

### Dominio

- **La cifra del Auditor se puede contradecir en silencio.** Tras resolver un caso, una
  segunda ronda que contradiga su valor reclasifica el artículo y **no abre discrepancia
  nueva** (la condición es «ninguna», no «ninguna abierta»). El inventario cierra con el
  valor del Auditor y él nunca supo que lo contradijeron. `consolidacion.service.ts:188`
- **La huella del cierre deja de demostrar lo que dice.** `referencia` sale del hash
  congelado al cerrar, pero las líneas del envío se recalculan en vivo. Nada impide cerrar
  después una ronda abandonada. `integracion.service.ts:171-208`
- **Un envío al ERP que primero falló nunca deja constancia de su éxito**, y se puede
  reenviar sin límite: la búsqueda de constancia previa excluye `'fallido'` y el
  `INSERT … ON CONFLICT DO NOTHING` no escribe. `integracion.service.ts:213-240`
- **Al cerrar, los artículos sin fila en `saldo_esperado` se pierden**: es un `UPDATE`, no
  un `UPSERT`, pero `enviarAlErp` sí los manda. La base local y el ERP divergen sin señal.
- **El número que se valida no es el que se guarda.** `toFixed(3)` sobre el binario del
  double frente al redondeo half-up de `numeric`: 19.8005 se valida como 19.800 y se
  guarda como 19.801. Produce filas marcadas discrepantes con contado y esperado idénticos.
- **`MAX_VERIFICACIONES` se reinicia abriendo otra ronda**: el contador es por
  `(ronda, artículo)` y nada limita cuántas rondas abre un operario en la misma bodega.
- **`buscarCandidatos` recorta por UUID, no por puntaje**: el `LIMIT 50` cae después de un
  `ORDER BY id` obligado por el `DISTINCT ON`.
- **Dos artículos que normalizan igual** (`AZÚCAR` / `Azucar`) se resuelven al azar: la
  unicidad del catálogo es sobre `nombre`, no sobre `nombre_normalizado`. El sistema elige
  por su cuenta, que es lo que FR-1.27 prohíbe.

### Agente de voz

- **«No estoy seguro» sostiene un conteo discrepante**: la condición es
  `dicho.includes('seguro')`. Un «ok» distraído hace lo mismo. `dialogo.ts:209`
- **«No, eso no es un hallazgo» registra el hallazgo**: `pideHallazgo()` busca por
  subcadena y se evalúa **antes** que la negación. `dialogo.ts:187`
- **Una alerta que llega del servidor pisa una confirmación pendiente**: el operario dice
  «sí» creyendo que confirma su aceite y sostiene una discrepancia ajena, perdiendo el
  aceite. `puente-voz.ts:193`
- **El hallazgo por voz se rechaza después de que el agente dijo que quedó anotado**: el
  contrato exige 20 caracteres y el diálogo nunca pide una descripción.
- **Confirmar en español real no confirma**: `AFIRMA` es un conjunto cerrado comparado
  contra la frase completa. «Sí, correcto» no está, y el ítem se descarta.
- **Al elegir candidato no se actualiza la unidad**: se registra la del primer candidato,
  que el operario nunca dijo.
- `turno()` no está serializado: dos transcripciones seguidas leen la misma fase.
- El WebSocket no tiene `maxPayload`, ni backpressure, ni latido, y los upgrades a rutas
  desconocidas quedan colgados.
- **Lo que gasta no se mide**: `/voz/sesion` abre Gemini Live todo el conteo y hace una
  llamada de TTS por frase, sin tope y sin telemetría. El tope de 400 minutos que sí
  existe cuelga del modo consulta, que está apagado.

### Plataforma

- **La inmutabilidad append-only es decorativa**: las migraciones revocan `UPDATE/DELETE`
  a `app_role`, pero la aplicación conecta como el **dueño** de las tablas y nunca emite
  `SET ROLE`. `DATABASE_APP_ROLE` está en `.env.example` y no lo lee nadie.
- **La sesión no se puede revocar**: 12 horas de cookie firmada, sin almacén de `jti`, con
  el rol dentro. Desactivar a alguien o degradarle el rol no surte efecto hasta que caduque.
- **El anti-fuerza-bruta del login es evitable**: nginx *pasa* `X-Forwarded-For` en vez de
  *añadirlo*, y la API confía en el primero de la cadena.
- **Un solo evento envenenado bloquea el outbox para siempre**: toda la pasada va en una
  transacción, sin contador de reintentos ni cola muerta. Ninguna ronda volvería a
  consolidarse y la única señal sería un `console.error` por segundo.
- **Ningún `fetch` a proveedor externo lleva timeout.** Con el pool en 10 conexiones, unas
  pocas peticiones colgadas tumban la API.
- **CloudFront habla con el origen por HTTP plano** contra una IP pública elástica.
- **Producción corre íntegramente en modo simulado**: ningún `PROVEEDOR_*` está en SSM. Y
  los nombres no coinciden — SSM define `ORACLE_FUSION_USER`, el código lee `ERP_USUARIO`.
- **`SESSION_SECRET` y `SEMILLA_PASSWORD` arrancan con el valor por defecto del repo**, y
  las semillas imprimen la clave a un log que se sube a S3 en cada despliegue.
- **CI no construye ni publica la imagen, y no verifica el frontend en absoluto**:
  `frontend/package.json` no declara `typecheck` ni `test`, así que `pnpm -r` los omite en
  silencio.
- La política IAM de despliegue permite `ssm:SendCommand` sobre `Resource: "*"` — root en
  cualquier EC2 de la cuenta.
- `docker-compose.yml` publica Postgres y Redis en `0.0.0.0`.

### Cableado

- **21 de 40 rutas del servidor no las llama nadie.** Historia 8 completa (mermas),
  Historia 9 completa (consulta del supervisor), el módulo de aprendizaje entero, el envío
  al ERP y sus constancias: implementados, probados, y sin una sola pantalla.
- **El motor de aprendizaje no puede activarse nunca.** Sus dos consultas de señal filtran
  por `origen_nombre = 'seleccion_usuario'` y por `origen_parse <> 'gramatica'`; el
  frontend no produce el primero jamás y hace el segundo mutuamente excluyente. Causa raíz:
  el dispositivo resuelve nombres con `find` + `includes` en vez de llamar a
  `/rondas/:r/resolucion-articulo`, así que los alias aprobados tampoco se aplican.
- **El proveedor de interpretación (D-09) es código muerto**: se instancia al arrancar y
  cero `@Inject`.
- **La evidencia de audio no existe**: `claveS3` es una cadena libre, no hay cliente S3, y
  el bucket aprovisionado no lo llena nadie. La retención de 180 días aplica a un prefijo
  vacío.
- **`GET /tiempo` no tiene consumidor**: el dispositivo sella `capturadoEn` con su reloj
  crudo, que es exactamente lo que esa ruta existe para evitar (FR-6.8).
- **FR-7.2 entrega media función**: el endpoint `.xlsx` existe y está probado; el tipo del
  cliente solo ofrece `csv`.
- El reconteo por voz del Auditor es inalcanzable: la ruta lo admite, pero resuelve por
  «ronda propia» y un auditor nunca posee una ronda.

### Pruebas que no prueban

- `ErpSimulado` está codificado para devolver siempre `'aceptado'`: el test del envío no
  puede fallar por una razón de negocio, y `ErpOracle` no tiene ni una prueba.
- «NO se emite credencial mientras la tarifa no esté verificada» afirma `201` (sí se emite).
- «El árbitro cae al determinista cuando la API falla» no inyecta ningún fallo.
- Dos pruebas de seguridad son un `grep` del código fuente: renombrar la constante las pasa.
- Seis suites dependen del reloj del proceso o del orden de ejecución.
- `--passWithNoTests` en los tres paquetes: si el `include` deja de casar, sale verde con
  cero pruebas.

---

## 4 · Lo que se intentó romper y aguantó

- **D8 / FR-7.9.** `grep` exhaustivo sobre `src/` y `drizzle/`: la única escritura a
  `saldo_esperado` fuera de las semillas está dentro de `cerrarInventario`. Ningún conteo,
  ninguna reproyección y ningún reconteo la tocan.
- **FR-1.18, la ceguera.** La guarda global niega por defecto —sin `@Roles` ni `@Publico`
  nadie entra— y ninguna ruta que devuelva saldo esperado lleva `'operador'`. `validar()`
  devuelve el mismo objeto para 10 y para 190 contra un saldo de 100; el esquema de
  respuesta no tiene dónde poner un saldo, una diferencia ni una tolerancia. Ni por tamaño,
  ni por campos opcionales, ni por código de error.
- **R4 / FR-4.4.** Doble candado: las dos rutas que cierran una discrepancia validan la
  causa contra el catálogo activo, y la restricción `cerrada_exige_razon` lo hace imposible
  aunque el código se equivocara.
- **Cero Web Speech API** en todo el repositorio, y **el audio de Gemini se descarta de
  verdad**: solo se lee `inputTranscription`. No existe camino por el que texto generado
  por el modelo llegue al operario. La clave de cuenta no sale al navegador.
- **El botón de silenciar es real**: descarta el bloque antes de convertirlo a PCM, dentro
  del callback de audio. Lo que no se manda no se transcribe ni se factura.
- **Idempotencia**: clave generada en el dispositivo antes de tocar la red, estable en el
  reintento, y el veredicto se devuelve **leído de la fila**, no recalculado.
- **Outbox**: la firma del bus exige la transacción, así que es imposible emitir un evento
  fuera de la transacción que persiste su causa.
- **Aritmética decimal**: `BigInt` escalado de punta a punta, sin un solo `number` en el
  camino y sin `===` sobre floats.
- **CSV para Excel en español**: BOM, separador `;`, comillas duplicadas y saltos escapados.
- **Grupos de seguridad**: ni un `0.0.0.0/0` en 22, 5432, 6379 ni 3000; RDS y Redis
  privados; SSH cerrado a favor de SSM; IMDSv2 obligatorio; contenedor no-root con `tini`.

---

## 5 · Lo más barato con más impacto

1. Cablear `casoDeFantasma` / `resolverFantasma` en la pantalla del Auditor **(§2.1)**.
   Hoy un hallazgo bloquea el cierre de esa bodega para siempre.
2. Validar en `cerrar()` que cada decisión esté entre los pendientes **(§2.2)**. Media
   docena de líneas.
3. `ORDER BY` en `unArticulo()` y una aserción anti-vacío **(§2.3)**. El patrón ya existe
   en `rutas-enrutado.spec.ts`; a la prueba de la ceguera es a la única que no se le aplicó.
4. Comprobar la negación **antes** que la subcadena en `dialogo.ts`, y quitar
   `includes('seguro')`. Dos condiciones.
5. `SET ROLE` en `platform/db/cliente.ts`: hace cierta la inmutabilidad que las migraciones
   documentan.
6. `AbortSignal.timeout()` en los cinco `fetch` a proveedores externos.
7. `typecheck` en `frontend/package.json` y `next build` en el CI.
