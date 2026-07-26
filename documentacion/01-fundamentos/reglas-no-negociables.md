# Reglas no negociables

Lo que este sistema **no puede hacer**, por qué, y dónde está impedido.

Las reglas están repartidas entre la [Constitución](./principios.md), la [especificación funcional](../02-producto/especificacion-funcional.md) y las [decisiones de diseño](../03-arquitectura/decisiones-de-diseno.md). Aquí están juntas y, sobre todo, **verificadas contra el código**. Cada una dice dónde vive la garantía y qué prueba la sostiene.

La distinción que importa: **una regla impuesta por el motor de base de datos no se puede violar ni con un error de código**; una impuesta por la aplicación depende de que nadie escriba la ruta equivocada. Están marcadas.

| | Regla | Garantía |
|---|---|---|
| R-01 | El conteo es a ciegas | Aplicación + forma de los tipos |
| R-02 | La alerta no revela dirección ni magnitud | Aplicación (función pura) |
| R-03 | Ningún conteo toca la tabla madre | Aplicación + `CHECK` de respaldo |
| R-04 | El libro es solo de inserción | **Motor** — ⚠️ **hoy no aplica** (ver §Lo que no está garantizado) |
| R-05 | Nada se cierra sin causa | **Motor** |
| R-06 | Una alerta se responde antes de cerrar | **Motor** (vista + `CHECK`) + aplicación |
| R-07 | Toda afirmación lleva veredicto congelado | **Motor** |
| R-08 | La cifra del Auditor prevalece; el árbitro no recomienda | Aplicación + forma del contrato |
| R-09 | Paridad voz / texto | Estructural (la voz no tiene ruta de escritura) |
| R-10 | El sistema pregunta en vez de adivinar | Aplicación |
| R-11 | Ningún modelo decide lo que es una condición | Estructural + aplicación |
| R-12 | Todo proveedor externo tiene alternativa | Configuración (arranque) |
| R-13 | La autorización niega por defecto | Aplicación (guarda global) |
| R-14 | Un reintento nunca duplica | **Motor** (claves únicas) |

---

## R-01 · El conteo es a ciegas

**Qué dice.** El Operador no puede obtener el saldo esperado por ningún medio, en ningún momento (FR-1.18, SC-1.3).

**Por qué existe.** Es la garantía de la que dependen todas las demás. Si el saldo se puede consultar, una coincidencia entre lo contado y lo esperado se puede *fabricar* sin recorrer el estante, y el inventario deja de ser evidencia de nada. No es una preferencia de UX: es la razón por la que una sola ronda basta para conciliar (D5).

**Dónde está garantizada.** No hay una línea que lo prohíba, hay una ausencia deliberada: ningún tipo de respuesta del dominio de captura tiene dónde poner el saldo. `apps/api/src/modules/captura/captura.controller.ts:27` lo declara; `ronda.service.ts:98` lo aísla dentro del servidor; `ronda.service.ts:665` excluye saldos y diferencias del estado que lee el Operador; `senales.service.ts:17` deja constancia de que ninguna de sus consultas lee `saldo_esperado`. En Redis el saldo se cachea **en servidor** y no se sirve nunca (D-18). La comparación ocurre solo en el servidor (Principio II), y por eso el frontend es un bundle estático sin lugar donde alojar lógica (D-03).

**Qué lo demuestra.** `apps/api/test/slice1.e2e.spec.ts:146` — la prueba E2 recorre **toda** respuesta que la API puede devolver a un rol Operador y compara valor por valor contra el saldo y la tolerancia **reales** de la base, no contra nombres de campo: renombrar la columna no la burla. La prueba además falla si no hay ningún valor prohibido que buscar, para no pasar en vano.

## R-02 · La alerta no revela ni dirección ni magnitud

**Qué dice.** Ante una diferencia relevante el sistema alerta, pero sin decir si sobra o falta, ni cuánto (FR-2.2).

**Por qué existe.** La alerta es un oráculo binario sobre "¿mi número cae dentro de la banda?". Con dirección y reintentos ilimitados, el saldo esperado se localiza por bisección en una decena de intentos — y R-01 se cae entera por la puerta de atrás. Se cierra por dos vías a la vez: el veredicto no distingue exceso de defecto aunque el servidor sí lo sepa, y **los intentos se agotan al tercero**.

**Dónde está garantizada.** `apps/api/src/modules/captura/validacion.ts:16` (el tipo `Veredicto` no tiene variante direccional) y `validacion.ts:48` (`MAX_VERIFICACIONES = 3`, con el razonamiento del oráculo escrito encima). Agotadas las verificaciones el veredicto pasa a `sin_verificacion` y deja de depender de la cantidad dictada (`validacion.ts:78`). El enum del motor incluye ese estado: `drizzle/0010_validacion.up.sql:30`.

**Qué lo demuestra.** `apps/api/test/slice2.e2e.spec.ts:216` — sobrar y faltar producen respuestas **idénticas**, y el sondeo repetido deja de responder al cuarto intento. `apps/api/test/validacion.spec.ts:131` lo prueba sobre la función pura.

## R-03 · Ningún conteo toca la tabla madre

**Qué dice.** Registrar un conteo **no** modifica el inventario original. Cada conteo es un registro hijo que conserva juntos el saldo del sistema y la cantidad contada (D8, FR-1.26). El saldo se mueve en **un solo punto**: el cierre con aval del Auditor (FR-7.9).

**Por qué existe.** Si un conteo escribiera el saldo, un número que nadie verificó se convertiría en el inventario de la compañía en el instante en que alguien lo dicta — y no habría forma de reconstruir qué decía el sistema antes. Guardar ambos valores en la misma fila permite responder "qué esperaba el sistema y qué encontró la gente" leyendo una sola fila.

**Dónde está garantizada.** El único `UPDATE saldo_esperado` de todo el código está en `apps/api/src/modules/integracion/integracion.service.ts:172`, dentro de la transacción de `cerrarInventario`, después de `exigirInventarioAvalado()` (`integracion.service.ts:92`), que rechaza si no hay rondas cerradas o si queda algún auditable sin resolver. La columna congelada vive en `drizzle/0003_libro.up.sql:59` (`saldo_esperado_congelado`), con la advertencia de que nunca se sirve al cliente. El motor pone un cinturón adicional: `conciliado_exige_conteo_afirmado` (`drizzle/0007_proyeccion.up.sql:43`) impide marcar como conciliado un artículo que **ninguna ronda afirmó**, y `valor_final_con_origen` (`0007:52`) impide que salga al ERP una cifra sin declarar de dónde viene.

**Qué lo demuestra.** `apps/api/test/inmutabilidad.spec.ts:107` — el motor rechaza un conciliado con `rondas_afirmando = 0` y un auditable sin motivo.

## R-04 · El libro es solo de inserción

**Qué dice.** Ningún registro se actualiza ni se borra. Una corrección **añade** una fila con mayor número de secuencia; el vigente es el de secuencia máxima (D2, FR-1.13).

**Por qué existe.** Sobrescribir destruye la contabilidad de las rondas, que es justamente lo que el inventario existe para producir. Un `UPDATE` que pase la revisión de código falla años después, cuando alguien note que un conteo cambió y ya no exista el original. No hay ni siquiera una columna `superseded_por`: rellenarla exigiría el `UPDATE` que la regla prohíbe (`drizzle/0003_libro.up.sql:46`).

**Dónde está garantizada.** `drizzle/0004_inmutabilidad.up.sql:16` revoca `UPDATE` y `DELETE` sobre `ronda`, `ronda_cierre`, `registro_conteo`, `producto_fantasma` y `evidencia_audio` para `app_role`, y `0004:25` cierra la recuperación por un `GRANT` posterior. La misma regla se aplica a las tablas nuevas: `reconteo` y `cierre_inventario` (`0008_auditoria.up.sql:62`), `evidencia_registro` (`0010_validacion.up.sql:85`), `critica_ronda` (`0015_propuestas.up.sql:86`), `consolidado_historico` (`0016_periodos.up.sql:134`). El vigente se lee por vista, no por columna mutable: `registro_vigente` (`0010:88`) y `reconteo_vigente` (`0008:44`).

**Qué lo demuestra.** `apps/api/test/inmutabilidad.spec.ts:56` recorre las siete tablas del libro y exige `permission denied` en `UPDATE` y en `DELETE`.

> ⚠️ **Esta regla NO está garantizada hoy por el motor.** Ver [§Lo que no está garantizado](#lo-que-no-está-garantizado). El código de la aplicación efectivamente no emite ningún `UPDATE` ni `DELETE` sobre el libro — verificado — pero eso es disciplina, que es exactamente lo que la migración 0004 se propuso no tener que confiar.

## R-05 · Nada se cierra sin causa

**Qué dice.** Ninguna discrepancia se cierra sin un código de razón de un **catálogo controlado**. Prohibido el ajuste sin causa (Restricción 4, FR-4.4).

**Por qué existe.** Un ajuste sin causa es un número que cambió y nadie puede explicar. El catálogo cerrado además hace la causa *agregable*: se puede contar cuántas mermas, cuántos errores de captura y cuántos hurtos hubo, que es la información que el negocio necesita para actuar sobre el proceso, no sobre la fila.

**Dónde está garantizada — MOTOR.** `CONSTRAINT cerrada_exige_razon` en `drizzle/0007_proyeccion.up.sql:77`: `CHECK (estado <> 'cerrada' OR (codigo_razon_id IS NOT NULL AND cerrada_en IS NOT NULL))`. Y `codigo_razon_id` es una clave foránea a `codigo_razon` (`0007:70`), así que la causa tiene que existir en el catálogo, no ser texto libre. La aplicación añade que además esté **activa**: `apps/api/src/modules/auditoria/auditoria.service.ts:395`.

**Nota.** `auditable_exige_motivo` (`0007:48`) es la regla gemela por el otro extremo: nada entra a la bandeja del Auditor sin decir por qué.

## R-06 · El operario responde la alerta antes de cerrar la ronda

**Qué dice.** Un conteo que generó alerta se corrige o se sostiene explícitamente; sostenerlo lo guarda con marca de advertencia y evidencia obligatoria (FR-2.4). Una ronda con alertas sin responder no cierra (FR-2.8).

**Por qué existe.** Una alerta sin responder al cerrar es un error que ya nadie va a poder explicar: el operario se fue, el estante cambió, y lo único que queda es un número que el sistema **sabía dudoso** y dejó pasar.

**Dónde está garantizada — MOTOR + aplicación.** La condición vive en **una sola** definición, la vista `pendiente_de_resolver` (`drizzle/0010_validacion.up.sql:107`), y la usan los dos sitios que la necesitan: el cuadre de cierre, que la muestra (`ronda.service.ts:334`), y el cierre, que la impone (`ronda.service.ts:466`). Dos consultas equivalentes escritas por separado divergirían justo donde una deja pasar lo que la otra bloquea. El motor impide además la marca sin causa: `advertido_exige_alerta` (`0010:60`) — no se puede marcar `advertido` un registro cuyo veredicto no fue una alerta. La alerta **no se guarda como estado**: es una propiedad del registro vigente, así que no hay una fila que alguien tenga que acordarse de cerrar ni puede quedar desincronizada.

**Matiz deliberado.** La evidencia de audio se exige solo cuando `modo_captura = 'voz'` (`0010:121`): solo se puede pedir la evidencia que puede existir. Una decisión tomada en la pantalla del cuadre no tiene audio, y exigírselo dejaría la ronda imposible de cerrar para siempre.

## R-07 · Toda afirmación lleva veredicto, y el veredicto se congela

**Qué dice.** Todo conteo que afirma algo tiene resultado de validación. La tolerancia aplicada se congela en la fila; los conteos no se revalúan retroactivamente (FR-8.2).

**Por qué existe.** Si el veredicto se recalculara al leer, subir mañana la merma del 2% al 5% cambiaría el pasado y nadie podría explicar por qué el sistema alertó, porque el motivo de la alerta ya no existiría. La traza se vuelve inservible. `no_contado` es la única excepción, porque no afirma nada.

**Dónde está garantizada — MOTOR.** `afirmacion_exige_veredicto` (`drizzle/0010_validacion.up.sql:55`) y las columnas congeladas `tolerancia_aplicada` / `resultado_validacion` (`0003_libro.up.sql:60`, `0010:34`). El complemento: `no_contado_sin_cantidad` y `contado_exige_cantidad` (`0003:81` y `0003:84`) impiden que "no contado" lleve cantidad y que "contado" no la lleve; `cantidad_no_negativa` (`0003:88`) elimina el conteo negativo. La regla de qué tolerancia aplica es una función pura sin base de datos ni red: `apps/api/src/modules/captura/validacion.ts:70`.

**Qué lo demuestra.** `apps/api/test/validacion.spec.ts:38` prueba el límite **exacto** de la tolerancia, el saldo negativo, la tolerancia cero y el caso de unidad de peso sin merma configurada — que aplica tolerancia 0 y deja la huella visible en vez de silenciarse.

## R-08 · La cifra del Auditor prevalece, y el árbitro nunca recomienda una cifra

**Qué dice.** El reconteo del Auditor es el valor final (FR-4.5). El árbitro ordena la evidencia del caso y **no** decide cuál cifra es correcta, ni la sugiere, ni insinúa qué ronda parece más fiable (FR-3.4).

**Por qué existe.** "¿Cuál de estas dos cifras es la correcta?" no es una condición: es un juicio sobre el mundo físico que el modelo no observó. Y si el sistema recomendara, el Auditor firmaría la recomendación — el día que se equivocara, nadie lo notaría, porque su cifra ya sería el inventario. El árbitro existe para que el humano tarde menos en decidir, no para decidir por él.

**Dónde está garantizada.** El valor del Auditor se escribe con `origen_valor = 'auditor'` en `apps/api/src/modules/auditoria/auditoria.service.ts:198`, y **además** lo recalcula la reproyección desde `reconteo`, así que sobrevive a reconstruir la bodega entera. La prohibición del árbitro está en la **forma de la salida**: `apps/api/src/proveedores/arbitraje/proveedor.ts:20` — el tipo no tiene campo de veredicto, ni de cantidad sugerida. El prompt del proveedor con modelo está escrito alrededor de lo que tiene prohibido hacer (`arbitraje/anthropic.ts:62`).

**Qué lo demuestra.** `apps/api/test/degradacion.spec.ts:53` — el árbitro **determinista** (sin modelo) tampoco emite veredicto: la degradación no relaja la regla. Y `degradacion.spec.ts:60`: si la API del modelo falla, cae al determinista en vez de bloquear al Auditor.

## R-09 · Paridad voz / texto

**Qué dice.** Todo lo que se puede hacer hablando se puede hacer escribiendo. Ninguna función existe solo por voz (FR-1.6, FR-1.21, Principio VIII).

**Por qué existe.** La voz es un proveedor externo y el ruido de bodega es real. Si alguna operación viviera solo en el canal de voz, un fallo del proveedor dejaría al operario sin poder trabajar — contra la Restricción 5.

**Dónde está garantizada — estructural.** El canal de voz **no tiene ruta de escritura propia**: no hay un solo `INSERT` en `apps/api/src/proveedores/agente-voz/` (verificado). El puente emite la acción `registrar` hacia el cliente (`puente-voz.ts:146`) y el registro entra por el mismo endpoint que usa el formulario, con el mismo esquema `RegistroEntradaSchema` (`packages/contracts/src/captura.ts:33`), donde `modoCaptura` es solo un campo de trazabilidad (Restricción 3). La validación es una función pura, así que el veredicto es idéntico venga el dato por voz o por texto (`validacion.ts:9`).

**Qué lo demuestra.** `apps/api/test/sintesis.spec.ts:78` — sin síntesis de voz el sistema avisa una vez y **sigue funcionando por texto**; el texto ya viajó a la pantalla.

## R-10 · El sistema pregunta en vez de adivinar

**Qué dice.** Cuando dos candidatos del catálogo están cerca, se presentan candidatos aunque el primero supere el umbral de aceptación. El sistema no elige por su cuenta en caso de duda (FR-1.11, FR-1.27).

**Por qué existe.** El catálogo real tiene `ACEITE`, `ACEITE DE OLIVA`, `ACEITE DE AJONJOLI` y `ACEITE DE OLIVA 10ML /BOLS`. Decir "aceite" no alcanza para elegir, y elegir por puntaje sería resolver al azar con apariencia de certeza. Preguntar cuesta un toque; un artículo mal resuelto cuesta una discrepancia que nadie sabrá explicar.

**Dónde está garantizada.** Dos umbrales, no uno: aceptación y **margen** entre el primer y el segundo candidato — `apps/api/src/modules/catalogo/resolucion.service.ts:30` (`UMBRAL_MARGEN = 0.15`) y la condición en `resolucion.service.ts:83`. La resolución es `pg_trgm`, no un modelo: el catálogo es cerrado y elegir de un conjunto cerrado es **selección, no generación** (D-19). El servidor **re-resuelve** al recibir el registro, y si difiere de la resolución local del dispositivo el registro no se corrige en silencio: se marca para el Auditor (D-19; el `textoDictado` existe para eso, `packages/contracts/src/captura.ts:51`).

**Qué lo demuestra.** `apps/api/test/inmutabilidad.spec.ts:158` — "aceite" devuelve varios candidatos; `inmutabilidad.spec.ts:145` — un nombre con error de transcripción sí resuelve.

## R-11 · Ningún modelo decide lo que se puede expresar como condición

**Qué dice.** Toda regla de validación, confirmación o alerta se implementa como código determinista. Los modelos interpretan entrada ambigua; nunca juzgan si un dato es válido (Restricción Técnica 1).

**Por qué existe.** Un modelo da respuestas distintas a la misma entrada en momentos distintos. Un inventario auditable no puede depender de eso: dos ejecuciones con la misma entrada tienen que dar el mismo resultado hoy y dentro de un año, o la traza no explica nada.

**Dónde está garantizada.** El reparto es explícito y estructural. En la ruta caliente no hay modelo: gramática determinista (D-08) + `pg_trgm` (D-19) + `validacion.ts`, una función pura sin base de datos y sin red (`apps/api/src/modules/captura/validacion.ts:70`). En el canal de voz el modelo es **solo el oído y la boca**: el audio que genera se **descarta sin escucharlo** (`apps/api/src/proveedores/agente-voz/sesion-voz.ts:197`) y lo que el operario oye lo redacta la máquina de estados de `dialogo.ts` y lo pronuncia un TTS palabra por palabra (`sesion-voz.ts:227`). *Si el modelo alucina, alucina en el texto que oyó — nunca en una cantidad registrada, porque la cantidad no pasa por él* (`dialogo.ts:21`). Y la salida del modelo de excepciones **siempre** vuelve a pasar por validación determinista antes de guardarse.

**Qué lo demuestra.** `apps/api/test/proveedores.spec.ts:42` — un artículo que el modelo **inventó** se rechaza; `proveedores.spec.ts:72` — una fracción verbal no entra disfrazada de propuesta; `proveedores.spec.ts:54` — con confianza baja se pregunta, porque preguntar es barato.

## R-12 · Todo proveedor externo tiene alternativa

**Qué dice.** Todo proveedor (voz, modelo, ERP) se consume detrás de una interfaz propia con implementación alternativa. Su degradación conmuta a un camino alterno y nunca deja al operario sin poder trabajar (Restricción 5).

**Por qué existe.** El sistema tiene que arrancar entero y demostrarse sin una sola credencial. Una dependencia externa que bloquea el arranque bloquea también el desarrollo, la prueba y la demostración — y en campo, el conteo.

**Dónde está garantizada.** `apps/api/src/config.ts:21` — **todos** los proveedores tienen `default('simulado')`: voz, interpretación, ERP, agente de voz, TTS. Las credenciales se exigen solo si se elige el proveedor real (`config.ts:85`), no al arrancar. El ERP se demuestra con adaptador simulado detrás de `PuertoInventarioERP` (D-24).

**Qué lo demuestra.** `apps/api/test/degradacion.spec.ts` completo, y `apps/api/test/sintesis.spec.ts:78` para el caso de la voz.

## R-13 · La autorización niega por defecto

**Qué dice.** Una ruta que no declara qué roles la pueden usar **no la puede usar nadie**. Y el rol dice qué se puede hacer; la pertenencia a la bodega dice sobre qué.

**Por qué existe.** El olvido de una anotación de autorización no se nota: la ruta funciona igual de bien para quien tiene permiso y para quien no. Con negación por defecto, el olvido falla ruidosamente en la primera prueba. La segunda mitad — la bodega — cierra un agujero real: cualquiera con rol de Auditor podía leer y **cerrar** el inventario de otra sede cambiando el UUID de la URL, y el UUID no es un secreto.

**Dónde está garantizada.** `apps/api/src/platform/autorizacion/sesion.guard.ts:47` — sin `@Roles` ni `@Publico` la ruta responde `SIN_AUTORIZACION_DECLARADA`. Es una guarda **global**, registrada para toda la aplicación: "si dependiera de recordar ponerla, algún día alguien no la pondría" (`sesion.guard.ts:22`). `bodega.guard.ts:39` comprueba `usuario_bodega` en toda ruta que lleve un `bodegaId`, también global, y devuelve el **mismo** mensaje que un rol insuficiente (`bodega.guard.ts:47`): distinguir "no es tuya" de "no existe" permitiría enumerar las bodegas de la compañía.

**Qué lo demuestra.** `apps/api/test/seguridad.spec.ts:37` (401 sin sesión), `:47` y `:61` (credenciales inválidas y usuario inexistente dan **exactamente** la misma respuesta: sin enumeración), `:109` (cookie manipulada). `apps/api/test/slice4.e2e.spec.ts:191` prueba la frontera del rol.

## R-14 · Un reintento nunca duplica

**Qué dice.** Cada registro porta una clave de idempotencia generada en el cliente **antes** de intentar el envío, y el servidor deduplica por ella. Un reenvío al ERP no duplica movimientos (Restricción 2, FR-6.2, FR-7.4).

**Por qué existe.** El registro se confirma al operario cuando es durable **localmente**, no cuando llega al servidor (D-15). Eso hace alcanzable el ciclo de 1.500 ms sin depender de la red, pero solo funciona si el reintento es seguro por construcción.

**Dónde está garantizada — MOTOR.** `clave_idempotencia uuid NOT NULL UNIQUE` en `registro_conteo` (`drizzle/0003_libro.up.sql:73`), `producto_fantasma` (`0003:103`) y `reconteo` (`0008_auditoria.up.sql:29`), con `INSERT … ON CONFLICT DO NOTHING`. Para el ERP, la referencia se deriva del **contenido** (huella SHA-256 del consolidado, `integracion.service.ts:396`), no de la hora: dos envíos de lo mismo llevan la misma referencia, y `constancia_salida.referencia` es `UNIQUE` (`0009_integracion.up.sql:20`), así que dos peticiones simultáneas no producen dos envíos. Un tercer candado: `un_cierre_por_bodega_y_periodo` (`0016_periodos.up.sql:47`) — dos cierres del mismo mes en la misma bodega son un doble clic, no un mes nuevo.

**Qué lo demuestra.** `apps/api/test/idempotencia.spec.ts:71` (el mismo envío repetido guarda una vez), `:92` (**diez reintentos simultáneos** siguen guardando una sola vez) y `:107` (claves distintas sí producen registros distintos: no deduplica de más).

---

## Lo que no está garantizado

**R-04, la inmutabilidad del libro, hoy NO la impone el motor.**

La migración `0004_inmutabilidad.up.sql` revoca `UPDATE` y `DELETE` sobre el rol `app_role`. Pero:

- `app_role` se crea **`NOLOGIN`** (`drizzle/0001_extensiones.up.sql:17`): nadie puede conectarse con él.
- La aplicación conecta con el usuario **dueño de las tablas** — `cci` en local (`docker-compose.yml:6`, `apps/api/src/config.ts:17`), `cci_admin` en RDS (`infra/terraform/datos.tf:26`). Un `REVOKE` **no afecta al dueño de la tabla** en PostgreSQL.
- No existe ningún `SET ROLE` en `apps/api/src` (verificado): la aplicación nunca asume `app_role` en tiempo de ejecución (`apps/api/src/platform/db/cliente.ts:15`).
- La prueba pasa porque **se pone el rol a mano**: `await t\`SET LOCAL ROLE app_role\`` en `apps/api/test/inmutabilidad.spec.ts:61`. Prueba que el `REVOKE` está bien escrito; no prueba que el código de producción esté sujeto a él.

Consecuencia exacta: **el `REVOKE` está correctamente definido y no se aplica a nadie.** Un `UPDATE registro_conteo` escrito por descuido pasaría hoy en producción. Hoy no existe ninguno —verificado en todo `apps/api/src`— y las estructuras (secuencia monótona, ausencia de columna `superseded_por`, vistas `registro_vigente` / `reconteo_vigente`) hacen que el camino correcto sea también el más fácil. Pero eso es disciplina de la capa de aplicación, que es literalmente lo que la migración 0004 declara no querer confiar.

Afecta por la misma causa raíz a todos los `REVOKE` del proyecto: `0008:62`, `0010:85`, `0015:86`, `0016:134`.

**Cómo se cierra**, en orden de esfuerzo: (a) que la aplicación conecte con un rol con `LOGIN` distinto del dueño y con solo `SELECT, INSERT` donde corresponde — el `GRANT` ya está escrito (`0003:107`), solo falta el rol y la cadena de conexión; o (b) `SET ROLE app_role` al tomar cada conexión del pool, que es más barato pero deja el usuario del dueño disponible para quien abra una conexión fuera del pool. La opción (a) es la que hace la regla verdaderamente inviolable. Mientras tanto, esta sección es la advertencia: **el documento no promete una garantía que hoy no existe.**

---

## Dos matices que conviene no perder

**La confirmación local no es una validación.** IndexedDB confirma "quedó registrado" en cuanto el dato es durable en el dispositivo (D-15); la alerta de discrepancia es una decisión del servidor y llega después. Si la interfaz mezcla los dos momentos, el operario creerá aprobado un conteo que aún no lo está.

**El sello del servidor y el momento del conteo son dos cosas.** Un registro creado sin red no puede tener sello de servidor en el instante en que ocurre. Se guardan los dos: `capturado_en` (cliente, anclado a una referencia sincronizada al abrir la ronda) y `recibido_en` (servidor, autoritativo), más el `desfase_reloj_ms` medido — `drizzle/0003_libro.up.sql:69` y `0003:22`. Un solo campo obligaría a mentir en uno de los dos sentidos, y en una auditoría el segundo es peor.
