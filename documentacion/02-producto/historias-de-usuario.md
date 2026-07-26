# Historias de usuario — Captura Inteligente de Inventarios (MVP)

> Este documento es un **extracto** de la [especificación funcional](../02-producto/especificacion-funcional.md): recoge las ocho historias de usuario tal como se especificaron, con sus escenarios de aceptación, requisitos (`FR-x.y`) y métricas (`SC-x.y`).
> Recoge **lo que se especificó**, no lo que hoy está construido. La vigencia de cada punto se lleva en [`06-calidad/estado-de-la-documentacion.md`](../06-calidad/estado-de-la-documentacion.md).

---

## Índice

| # | Historia | Prioridad | Quién la ejecuta | Qué resuelve |
|---|---|---|---|---|
| [1](#historia-1--conteo-ciego-en-ronda-propia-p1) | Conteo ciego en ronda propia | P1 | Operador | Reemplaza el papel: el dato nace digital, con autor y hora, sin ver nunca el saldo esperado |
| [2](#historia-2--validaciones-inteligentes-y-alerta-de-discrepancia-p2) | Validaciones inteligentes y alerta de discrepancia | P2 | Operador (el sistema valida) | Atrapa el error de unidad o de cantidad mientras la persona sigue frente al producto |
| [3](#historia-3--consolidación-y-clasificación-contra-el-saldo-esperado-p3) | Consolidación y clasificación contra el saldo esperado | P3 | El sistema (sin rol humano) | Acumula las rondas y separa lo conciliado de lo auditable |
| [4](#historia-4--reconteo-del-auditor-p4) | Reconteo del Auditor | P4 | Auditor | Recuenta solo lo que quedó en duda y lo cierra con una causa |
| [5](#historia-5--productos-fantasma-p5) | Productos fantasma | P5 | Operador (resuelve el Auditor) | Da casilla a la mercancía real que no está en el catálogo |
| [6](#historia-6--continuidad-ante-pérdida-de-red-p6) | Continuidad ante pérdida de red | P6 | Operador | Un microcorte de Wi-Fi no obliga a repetir trabajo |
| [7](#historia-7--salida-de-datos-e-integración-con-el-sistema-central-p7) | Salida de datos e integración con el sistema central | P7 | Usuario autorizado | Elimina la transcripción manual: CSV/Excel o envío directo |
| [8](#historia-8--administración-de-tolerancias-de-merma-p8) | Administración de tolerancias de merma | P8 | Administrador | Cambiar la merma tolerada sin depender del equipo técnico |

**Núcleo del MVP: P1 a P4.** Con esas cuatro el sistema reemplaza el papel de punta a punta. P5 a P8 completan el producto.

La especificación **no contiene historias secundarias** más allá de estas ocho: no hay modo consulta de supervisor ni variantes de solo lectura. El tablero de administración se especifica aparte, en [`05-tablero/diseno-del-tablero.md`](../05-tablero/diseno-del-tablero.md).

---

## Decisiones de negocio que gobiernan estas historias

Las historias se apoyan en estas decisiones; se listan para poder cruzarlas por identificador.

| ID | Decisión | Estado |
|---|---|---|
| **D1** | Cierre de ronda: captura libre con cuadre al cerrar (*contado en cero* vs *no contado*) | Vigente, restablecida por D7 |
| **D2** | Rondas independientes, inmutables y acumulativas; nada se actualiza en sitio | Vigente |
| **D3** | Identidad propia, sustituible por el directorio institucional | Vigente |
| **D4** | Doble registro en la misma ronda: es corrección — supersede, no suma | Vigente |
| **D5** | La ceguera es la garantía: una ronda basta, el Auditor avala | Vigente (enmendada 2026-07-25; sustituye el doble conteo obligatorio) |
| **D6** | Trabajo dirigido (el sistema dicta qué contar) | ⛔ **REVOCADA** el 2026-07-25, sin efecto |
| **D7** | Captura libre con resolución determinista del nombre | ⭐ **Vigente** — restablece D1 y revoca D6 |
| **D8** | La base madre no se sobrescribe: los conteos son registros hijos | Vigente |

---

## Historia 1 — Conteo ciego en ronda propia (P1)

**Rol:** Operador.

El Operador llega a la bodega con el dispositivo de la compañía, entra con su usuario y contraseña y escoge la bodega. El sistema abre una ronda a su nombre: lo que él registre es suyo y no se mezcla con lo de nadie más. Inicia el agente de voz y **dicta lo que ve**, artículo por artículo: nombre, cantidad total y unidad. El sistema resuelve el nombre contra el catálogo; si lo tiene claro lo confirma y guarda, y si duda le muestra los nombres más parecidos para que toque el correcto. Nunca ve cuánto esperaba encontrar el sistema. Al terminar, cuadra los artículos que no registró y cierra su ronda.

### Valor para el usuario

Es la única historia que por sí sola reemplaza el papel. El Operador deja de escribir a mano y de esperar días para saber si lo que anotó servía. Para el negocio, es el punto donde el dato deja de nacer en un papel y nace ya digital, con autor y hora.

### Prueba independiente

Un Operador dicta 20 artículos reales de una bodega —la mitad por voz y la mitad digitando—, al menos uno de ellos con un nombre que obliga a escoger entre candidatos, cierra su ronda, y existe un registro íntegro de los 20 con cantidad, unidad, autor, momento y modo de captura, más el estado explícito de los artículos que no contó. Verificable sin que exista aún validación, consolidación ni Auditor.

### Escenarios de aceptación

1. **Dado** un Operador con credenciales válidas, **cuando** inicia sesión, **entonces** el sistema deduce su rol desde la base de datos y le presenta la lista de bodegas, sin pedirle nunca que escoja su propio rol.
2. **Dado** un Operador que escoge una bodega, **cuando** inicia el conteo, **entonces** el sistema abre una ronda a su nombre que no altera ni sobrescribe ninguna otra ronda, ni de otras personas ni suyas anteriores.
3. **Dado** un Operador con la ronda abierta, **cuando** dicta "platos cuadrados, tres unidades", **entonces** el sistema resuelve el nombre contra el catálogo de la bodega, muestra el artículo interpretado con la cantidad y la unidad, y registra el conteo.
3-bis. **Dado** un nombre dictado que el sistema no resuelve con certeza, **cuando** termina de interpretarlo, **entonces** presenta en pantalla los nombres más parecidos del catálogo para que el Operador toque el correcto, y NO elige por su cuenta.
4. **Dado** un Operador que prefiere digitar, **cuando** escribe el artículo, la cantidad y la unidad, **entonces** el sistema exige una verificación explícita en pantalla antes de guardar.
5. **Dado** un registro guardado con éxito, **cuando** el sistema lo confirma, **entonces** la confirmación es perceptible de forma visual **y** auditiva.
6. **Dado** un Operador contando, **cuando** consulta la pantalla en cualquier momento, **entonces** no aparece por ningún medio el saldo esperado por el sistema.
7. **Dado** un Operador que dicta "medio kilo de sal", **cuando** el sistema interpreta la cantidad, **entonces** la rechaza y le pide un número exacto.
8. **Dado** un artículo dictado o digitado que admite varias interpretaciones, **cuando** el sistema no puede resolverlo con certeza, **entonces** muestra las opciones más probables para que el Operador escoja tocando la pantalla, y NO elige por su cuenta.
9. **Dado** un artículo ya registrado en la ronda en curso, **cuando** el Operador lo vuelve a registrar, **entonces** el sistema advierte que ya fue contado, exige confirmación explícita, y el nuevo valor supersede al anterior conservando ambos en la traza.
10. **Dado** un Operador que termina de contar, **cuando** solicita cerrar la ronda, **entonces** el sistema le presenta los artículos del catálogo que no registró y le exige decidir, por cada uno, entre *contado en cero* y *no contado*.
11. **Dado** un cuadre de cierre resuelto, **cuando** la ronda se cierra, **entonces** ningún artículo del catálogo de esa bodega queda en estado indefinido.
12. **Dado** una ronda cerrada, **cuando** cualquier persona intenta modificar uno de sus registros, **entonces** el sistema lo impide.

### Edge cases

- **Cantidad en fracción verbal** ("medio", "un cuarto") → se rechaza y se pide número exacto.
- **Nombre de artículo que contiene un número** ("aceite 3 litros", "guantes talla 8") → el sistema debe distinguir el número que forma parte del nombre del que es la cantidad dictada. Ante duda, presenta candidatos y pregunta; no adivina. *(Edge case propio de la captura libre, D7.)*
- **Nombre dictado que no existe en el catálogo** → no se descarta: se ofrece registrarlo como producto fantasma (Historia 5).
- **Dos artículos del catálogo con nombres casi idénticos** → siempre se presentan como candidatos; el sistema no resuelve por puntaje cuando el margen entre los dos primeros es estrecho.
- **Artículo sin código de producto** → el nombre del artículo es el identificador; el código se incluye solo cuando existe.
- **Ruido ambiental que impide el reconocimiento de voz** → el Operador puede pasar a texto sin perder el ítem en curso.
- **Reconocimiento de voz no disponible** → el sistema conmuta a captura por texto y el Operador sigue trabajando.
- **Dos personas contando la misma bodega a la vez** → cada una en su ronda; los registros no se pisan.
- **Ronda dejada a medias y retomada otro día** → sigue abierta a nombre de su autor; el cuadre de cierre se presenta solo al cerrarla.
- **Intento de corregir un registro guardado** → no se sobrescribe: se supersede y ambos quedan en la traza.
- **Sesión expirada durante el conteo** → se solicita reautenticación sin perder los registros ya confirmados.
- **Cierre del navegador o batería agotada** → al volver a entrar, la ronda sigue abierta con todo lo registrado.

### Requisitos verificables

- **FR-1.1**: El sistema MUST autenticar mediante usuario y contraseña.
- **FR-1.2**: El sistema MUST deducir el rol desde la base de datos y MUST NOT permitir que el usuario seleccione su propio rol.
- **FR-1.3**: El sistema MUST exigir la selección de una bodega antes de iniciar el conteo.
- **FR-1.4**: El sistema MUST abrir una ronda propia por persona y bodega, identificada por autor, bodega y momento de apertura.
- **FR-1.5**: Una ronda MUST NOT sobrescribir, fusionar ni alterar registros de otra ronda.
- **FR-1.6**: El sistema MUST permitir registrar por voz y por texto, con paridad funcional completa entre ambos modos.
- **FR-1.7**: El sistema MUST exigir verificación explícita en pantalla antes de guardar un conteo ingresado por texto.
- **FR-1.8**: El sistema MUST confirmar cada registro exitoso de forma visual y auditiva.
- **FR-1.9**: El sistema MUST aceptar solo cantidades numéricas exactas y MUST rechazar expresiones fraccionarias verbales.
- **FR-1.10**: El sistema MUST capturar la cantidad **total** del artículo en la bodega, no cantidades parciales por ubicación.
- **FR-1.11**: El sistema MUST presentar interpretaciones candidatas seleccionables por toque cuando el artículo sea ambiguo o incompleto, y MUST NOT elegir por su cuenta en caso de duda. Es **flujo normal** del conteo (D7), no una excepción.
- **FR-1.22**: El sistema MUST resolver el nombre dictado contra el catálogo de la bodega mediante búsqueda determinista por similitud de texto, y MUST NOT delegar esa resolución a un modelo de lenguaje (D7, Restricción 1).
- **FR-1.23**: El sistema MUST registrar el conteo sin intervención del Operador cuando la resolución del nombre sea inequívoca, y MUST exigir su selección en pantalla cuando no lo sea.
- **FR-1.24**: El sistema MUST mostrar el artículo resuelto junto a la cantidad y la unidad interpretadas antes de darlas por registradas.
- **FR-1.25**: El sistema MUST NOT dictar al Operador qué artículo contar ni imponerle un orden de recorrido.
- **FR-1.26**: El sistema MUST registrar cada conteo como un registro hijo que conserva **el saldo original del sistema y la cantidad contada juntos**, y MUST NOT modificar el inventario original al registrar un conteo (D8).
- **FR-1.27**: El sistema MUST presentar candidatos, en vez de resolver por puntaje, cuando el margen entre las dos mejores coincidencias del catálogo no supere el umbral configurado.
- **FR-1.12**: El sistema MUST registrar, por cada conteo, el modo de captura (voz o texto), el autor, el momento y la bodega.
- **FR-1.13**: El sistema MUST tratar todo registro como inmutable: una corrección MUST crear un registro nuevo que supersede al anterior y MUST NOT modificar ni borrar el original.
- **FR-1.14**: El sistema MUST advertir y exigir confirmación explícita al registrar un artículo ya contado en la ronda en curso, y MUST NOT sumar las cantidades.
- **FR-1.15**: El sistema MUST presentar, antes de permitir el cierre de una ronda, los artículos del catálogo no registrados, exigiendo por cada uno la decisión entre *contado en cero* y *no contado*.
- **FR-1.16**: El sistema MUST distinguir de forma permanente *contado en cero* de *no contado*, y MUST NOT tratarlos como equivalentes en ninguna validación, consolidado o exportación.
- **FR-1.17**: El sistema MUST impedir la modificación de los registros de una ronda cerrada.
- **FR-1.18**: El sistema MUST NOT exponer al Operador el saldo esperado por ningún medio, en ningún momento.
- **FR-1.19**: Toda función MUST ser operable desde el navegador de los dispositivos móviles de la compañía, sin instalar una aplicación nativa.
- **FR-1.20**: La interfaz MUST cumplir WCAG 2.1 nivel AA y MUST ser operable con una sola mano.
- **FR-1.21**: El sistema MUST permitir seguir capturando por texto cuando el reconocimiento de voz no esté disponible.

### Métricas de éxito

- **SC-1.1**: Un turno completo (el Operador dicta nombre, cantidad y unidad → el sistema resuelve, muestra y registra) toma menos de 15 segundos por voz.
- **SC-1.8**: Al menos el 90% de los nombres dictados se resuelve contra el catálogo sin que el Operador tenga que escoger entre candidatos.
- **SC-1.2**: El 95% de los registros recibe confirmación en menos de 1,5 segundos desde que el usuario termina de ingresar el dato.
- **SC-1.3**: El saldo esperado no es obtenible desde el dispositivo del Operador por ningún medio, verificado sobre todo lo que el dispositivo recibe y almacena.
- **SC-1.4**: Al cerrar una ronda, el 100% de los artículos del catálogo de la bodega queda en un estado explícito: contado, contado en cero, o no contado.
- **SC-1.5**: Ningún registro puede modificarse ni desaparecer después de guardado: toda corrección es rastreable como registro adicional sobre la traza completa de la ronda.
- **SC-1.6**: Paridad voz/texto: el 100% de las funciones de captura puede completarse íntegramente por cualquiera de los dos modos.
- **SC-1.7**: Un operario completa el flujo de conteo de principio a fin con una sola mano y con lector de pantalla activo.

### Supuestos y dependencias

- **Supuesto**: las rondas se cierran explícitamente por su autor; el sistema no las cierra por inactividad.
- **Supuesto**: los dispositivos son teléfonos y tabletas de la compañía con navegador moderno.
- **Dependencia**: catálogo de artículos por bodega, con nombre, código cuando exista y unidad de medida esperada, provisto por el sistema central.
- **Dependencia**: padrón de usuarios con su rol asignado (D3).

### Fuera de alcance de esta historia

- Validación de unidad y de discrepancia → Historia 2.
- Registro de artículos no catalogados → Historia 5.
- Recuperación ante pérdida de red → Historia 6.
- Alta de usuarios y gestión de contraseñas: se asume administrada fuera del sistema en el MVP.

---

## Historia 2 — Validaciones inteligentes y alerta de discrepancia (P2)

**Rol:** Operador (la validación la ejecuta el sistema fuera de su dispositivo).

Mientras el Operador cuenta, el sistema compara en segundo plano lo contado contra el catálogo y el saldo esperado. Si la unidad no corresponde, se lo dice y le indica cuál es la correcta. Si la cantidad se aparta más de lo tolerable, le pregunta si está seguro —sin revelarle nunca cuánto esperaba encontrar—. Si el Operador confirma, el dato queda marcado con evidencia obligatoria.

### Valor para el usuario

Es el valor diferencial frente al papel: atrapa el error donde todavía cuesta tres metros corregirlo, no días después. Para el Operador significa no cargar con la culpa de un error que nadie le señaló a tiempo.

### Prueba independiente

Con un catálogo cargado y saldos conocidos, se cuentan artículos con unidad equivocada, con cantidad dentro de tolerancia y con cantidad fuera de tolerancia. El sistema alerta exactamente en los dos casos que corresponde y marca evidencia solo cuando el usuario confirma pese a la alerta.

### Escenarios de aceptación

1. **Dado** un artículo cuya unidad esperada es kilogramos, **cuando** el Operador registra "20 unidades", **entonces** el sistema alerta e indica cuál es la unidad correcta esperada.
2. **Dado** un artículo con saldo esperado de 100 unidades, **cuando** el Operador cuenta 60, **entonces** el sistema lanza la alerta de discrepancia sin revelar el saldo ni la magnitud de la diferencia.
3. **Dado** un artículo medido en peso y una tolerancia de merma configurada, **cuando** la diferencia queda dentro de la tolerancia, **entonces** el sistema registra sin alertar.
4. **Dado** el mismo artículo, **cuando** la diferencia supera la tolerancia —a favor o en contra—, **entonces** el sistema lanza la alerta de discrepancia.
5. **Dado** un artículo que no se mide por peso, **cuando** existe cualquier diferencia contra el saldo esperado, **entonces** el sistema alerta sin aplicar tolerancia.
6. **Dado** una alerta de discrepancia activa, **cuando** el Operador confirma su conteo, **entonces** el registro se guarda con marca de advertencia y evidencia obligatoria.
7. **Dado** una alerta de discrepancia activa, **cuando** el Operador decide corregir en vez de confirmar, **entonces** puede volver a contar sin que el intento anterior desaparezca de la traza.
8. **Dado** cualquier validación, **cuando** se ejecuta, **entonces** su resultado es idéntico sin importar si el ingreso fue por voz o por texto.
9. **Dado** un artículo marcado como *contado en cero* en el cuadre de cierre, **cuando** el sistema lo valida, **entonces** lo trata como una cantidad contada y aplica la validación de discrepancia.
10. **Dado** un artículo marcado como *no contado*, **cuando** el sistema lo procesa, **entonces** NO genera alerta de discrepancia, porque no hubo afirmación sobre la realidad física.

### Edge cases

- **Artículo esperado que no aparece físicamente** → se registra cantidad cero, lo que activa la validación como cualquier otra diferencia.
- **Saldo esperado no disponible para un artículo** → el conteo se registra y el artículo queda marcado como no validable, para revisión del Auditor. Nunca se descarta el conteo.
- **Tolerancia de merma no configurada para una unidad de peso** → se aplica tolerancia cero y se alerta ante cualquier diferencia; queda registrado que faltaba configuración.
- **Diferencia exactamente igual al límite de tolerancia** → se considera dentro de tolerancia y no alerta.
- **Cantidad negativa** → se rechaza en la captura; no existe conteo negativo.
- **Alerta pendiente de respuesta cuando el Operador cierra la ronda** → el cierre se bloquea hasta resolver todas las alertas abiertas.

### Requisitos verificables

- **FR-2.1**: El sistema MUST validar que la unidad ingresada corresponda a la esperada para el artículo y, si no, MUST informar cuál es la correcta.
- **FR-2.2**: El sistema MUST comparar la cantidad contada contra el saldo esperado y MUST alertar ante una diferencia relevante, sin revelar el saldo ni la magnitud de la diferencia.
- **FR-2.3**: El sistema MUST tolerar, para artículos medidos por peso, una diferencia dentro del porcentaje de merma configurado, y MUST alertar al superarlo tanto a favor como en contra.
- **FR-2.4**: El sistema MUST guardar con marca de advertencia y evidencia obligatoria todo conteo confirmado por el usuario pese a una alerta.
- **FR-2.5**: El sistema MUST ejecutar toda validación fuera del dispositivo del Operador, con resultado idéntico sea cual sea el modo de captura.
- **FR-2.6**: El sistema MUST implementar las reglas de validación de forma determinista y MUST NOT delegar a un modelo de lenguaje la decisión sobre si un dato es válido.
- **FR-2.7**: El sistema MUST tratar *contado en cero* como cantidad contada a efectos de validación, y MUST NOT generar discrepancia para artículos *no contados*.
- **FR-2.8**: El sistema MUST impedir el cierre de una ronda con alertas de discrepancia sin resolver.
- **FR-2.9**: El sistema MUST conservar en la traza los intentos de conteo corregidos tras una alerta.
- **FR-2.10**: El sistema MUST registrar el conteo aun cuando no exista saldo esperado para el artículo, marcándolo como no validable.

### Métricas de éxito

- **SC-2.1**: El 100% de los errores de unidad de medida se detecta durante el conteo, antes de que el Operador pase al siguiente artículo.
- **SC-2.2**: El 100% de las diferencias que superan la tolerancia genera alerta, y el 0% de las que están dentro de tolerancia la genera.
- **SC-2.3**: El 100% de los conteos confirmados pese a una alerta queda con marca de advertencia y evidencia.
- **SC-2.4**: La alerta de discrepancia no permite deducir el saldo esperado ni la magnitud de la diferencia, verificado sobre el contenido completo del mensaje.
- **SC-2.5**: Ninguna ronda puede cerrarse con alertas sin resolver.

### Supuestos y dependencias

- **Supuesto**: la tolerancia de merma aplica únicamente a artículos cuya unidad de medida es de peso. El 0,2% que menciona `SPEC.md` §4.2 es un ejemplo, no un valor confirmado por el negocio.
- **Supuesto**: el saldo esperado se consulta del sistema central y esta aplicación no lo modifica.
- **Dependencia**: acceso a los saldos esperados por bodega y artículo.
- **Dependencia**: valores iniciales de tolerancia de merma, provistos por el negocio (su administración es la Historia 8).
- **Dependencia**: Historia 1 debe existir para producir los registros que se validan.

### Fuera de alcance de esta historia

- Quién resuelve la discrepancia → Historia 4.
- Configuración de las tolerancias por pantalla → Historia 8.
- Comparación entre rondas → Historia 3.

---

## Historia 3 — Consolidación y clasificación contra el saldo esperado (P3)

**Rol:** ninguno — la ejecuta el sistema. Su resultado lo consume el Auditor (Historia 4).

Cerrada la ronda —o las rondas— de una bodega, el sistema las acumula y determina qué quedó resuelto y qué no. Un artículo se da por bueno cuando el conteo ciego coincide con el saldo esperado dentro de la tolerancia aplicable. Todo lo demás se marca como auditable, con el detalle de quién contó cuánto en cada ronda.

### Valor para el usuario

Es el motor que convierte los conteos en una conclusión. Para el negocio es la garantía de D5: como el Operador no puede ver el saldo esperado, una coincidencia no se pudo fabricar — contar bien es la única forma de producirla. Para el Auditor es lo que le permite recontar 8 artículos en vez de recorrer 800, con las diferencias ya aisladas y atribuidas.

### Prueba independiente

Con **una** ronda cerrada sobre una bodega, el sistema clasifica correctamente: artículos cuyo conteo coincide con el saldo esperado dentro de tolerancia (conciliados), artículos con discrepancia, productos fantasma, y artículos sobre los que la ronda no afirmó nada. Con una segunda ronda presente, clasifica además como auditables los artículos que las dos contaron con cantidades distintas. Verificable sin que exista aún la pantalla del Auditor.

### Escenarios de aceptación

1. **Dado** una ronda cerrada cuyo conteo de un artículo coincide con el saldo esperado dentro de la tolerancia aplicable, **cuando** el sistema consolida, **entonces** el artículo queda **conciliado** y no exige reconteo del Auditor.
2. **Dado** una ronda cerrada cuyo conteo presenta discrepancia contra el saldo esperado, **cuando** el sistema consolida, **entonces** el artículo queda **auditable** con motivo *discrepancia*.
3. **Dado** dos rondas cerradas con cantidades distintas para el mismo artículo, **cuando** el sistema consolida, **entonces** el artículo queda **auditable** con motivo *contradicción entre rondas* y el sistema NO elige cuál prevalece — aunque ambas cantidades estén dentro de tolerancia contra el saldo esperado.
4. **Dado** dos rondas donde una coincide con el saldo esperado y la otra no, **cuando** el sistema consolida, **entonces** el artículo queda **auditable**: basta con que una ronda haya producido diferencia.
5. **Dado** un artículo marcado *no contado* en todas las rondas cerradas, **cuando** el sistema consolida, **entonces** queda **auditable** con motivo *sin cobertura*, porque ninguna ronda afirmó nada sobre la realidad física.
6. **Dado** un artículo marcado *contado en cero*, **cuando** el sistema consolida, **entonces** lo trata como una cantidad afirmada y le aplica la regla normal contra el saldo esperado.
7. **Dado** una bodega con **una sola** ronda cerrada, **cuando** el sistema consolida, **entonces** clasifica normalmente y NO marca nada como auditable por el solo hecho de que haya una única ronda.
8. **Dado** un consolidado, **cuando** se revisa, **entonces** cada ronda conserva su autor, su momento y sus cantidades originales, sin fusiones ni modificaciones.
9. **Dado** una bodega sin ninguna ronda cerrada, **cuando** se intenta cerrar el inventario, **entonces** el sistema lo impide.
10. **Dado** un artículo con registros superseded dentro de una ronda, **cuando** el sistema consolida, **entonces** toma el valor vigente de esa ronda e ignora los superseded, que permanecen en la traza.

### Edge cases

- **Tres o más rondas sobre la misma bodega** → todas se acumulan; si alguna difiere de las otras o del saldo esperado, el artículo es auditable.
- **Dos rondas que coinciden entre sí y con el saldo esperado** → conciliado, igual que con una sola. La segunda ronda no cambia el resultado, solo lo respalda.
- **Dos rondas de la misma persona** → permitidas y acumuladas; la regla de confirmación no depende de cuántas personas contaron, sino de la coincidencia con el saldo esperado.
- **Ronda abandonada sin cerrar** → no participa de la consolidación hasta cerrarse; el sistema informa que existe.
- **Segunda ronda que empieza mientras la primera sigue abierta** → permitido; la consolidación incorpora cada ronda al cerrarse.
- **Artículo agregado al catálogo después de una ronda cerrada** → si ninguna ronda lo afirmó, queda auditable por *sin cobertura*, sin penalizar retroactivamente a la ronda anterior.
- **Artículo sin saldo esperado** → no validable contra el sistema (FR-2.10): queda auditable, nunca conciliado.

### Requisitos verificables

- **FR-3.1**: El sistema MUST acumular todas las rondas cerradas de una bodega en un consolidado que preserve, por artículo, qué registró cada ronda y quién la ejecutó.
- **FR-3.2**: El sistema MUST marcar un artículo como **conciliado** cuando su conteo ciego coincida con el saldo esperado dentro de la tolerancia aplicable y ninguna ronda haya producido diferencia. **Una sola ronda es suficiente** (D5).
- **FR-3.3**: El sistema MUST marcar como auditable todo artículo con discrepancia contra el saldo esperado, con contradicción entre rondas, sin cobertura de ninguna ronda, sin saldo esperado disponible, o registrado como producto fantasma.
- **FR-3.4**: El sistema MUST NOT resolver automáticamente cuál ronda prevalece cuando dos se contradicen.
- **FR-3.5**: El sistema MUST soportar más de una ronda por bodega y MUST NOT exigirlas: ni para conciliar un artículo, ni para cerrar el inventario.
- **FR-3.6**: El sistema MUST tomar, por ronda y artículo, el registro vigente, ignorando los superseded sin eliminarlos de la traza.
- **FR-3.7**: El sistema MUST impedir el cierre del inventario de una bodega sin al menos una ronda cerrada.
- **FR-3.8**: El consolidado MUST NOT alterar, fusionar ni recalcular los registros originales de ninguna ronda.
- **FR-3.9**: El sistema MUST tratar *no contado* como ausencia de afirmación, no como cantidad, y MUST NOT conciliar un artículo que ninguna ronda afirmó.
- **FR-3.10**: El sistema MUST marcar como auditable un artículo si **cualquiera** de las rondas que lo contaron produjo diferencia contra el saldo esperado, aunque otra ronda haya coincidido.

### Métricas de éxito

- **SC-3.1**: El 100% de los artículos de una bodega queda clasificado tras la consolidación como conciliado o auditable, sin estados intermedios.
- **SC-3.2**: Ningún artículo se concilia sin que al menos una ronda haya afirmado una cantidad que coincide con el saldo esperado dentro de tolerancia, verificable sobre el consolidado completo.
- **SC-3.3**: Con dos operadores contando la misma bodega al tiempo, el 100% de los registros de cada uno llega íntegro al consolidado y ninguno queda sobrescrito.
- **SC-3.4**: El consolidado reproduce exactamente las cantidades originales de cada ronda, comparado contra la traza de registros.
- **SC-3.5**: Una bodega con una sola ronda cerrada produce un consolidado completo y cerrable, sin ítems marcados auditables por falta de una segunda ronda.

### Supuestos y dependencias

- **Supuesto**: la coincidencia que confirma es entre el conteo y el **saldo esperado**, con la tolerancia de merma vigente al momento del conteo (FR-2.3, FR-8.2). No hay comparación con tolerancia entre rondas: dos rondas que difieren en cualquier magnitud van al Auditor.
- **Supuesto**: el Auditor pertenece a un equipo independiente de quien ejecutó las rondas — interno o externo (D5).
- **Dependencia**: Historias 1 y 2 deben existir para producir rondas cerradas y validadas.

### Fuera de alcance de esta historia

- La pantalla donde el Auditor resuelve lo auditable → Historia 4.
- El envío del resultado al sistema central → Historia 7.

---

## Historia 4 — Reconteo del Auditor (P4)

**Rol:** Auditor.

El Auditor entra, escoge la bodega y recibe el consolidado. Ve únicamente los artículos auditables, con el detalle de qué contó cada persona en cada ronda y la diferencia contra lo esperado. Va físicamente al producto, registra su reconteo con la misma mecánica de voz o texto, y cierra cada caso con una causa.

### Valor para el usuario

Cierra el ciclo de control: es lo que convierte el conteo en un dato del que alguien responde. El Auditor no recorre la bodega entera, solo lo que quedó en duda, con la información de por qué quedó en duda.

### Prueba independiente

Con un consolidado que dejó 5 discrepancias, 2 productos fantasma y 1 artículo donde las rondas se contradicen, el Auditor abre la bodega, ve exactamente esos 8 ítems y ninguno más, con el detalle por ronda, y registra reconteo y causa sobre cada uno.

### Escenarios de aceptación

1. **Dado** un Auditor autenticado, **cuando** selecciona la bodega, **entonces** ve solo los ítems auditables y no el resto del inventario.
2. **Dado** un ítem auditable, **cuando** el Auditor lo abre, **entonces** ve la diferencia entre lo contado y lo esperado, y el espacio para su reconteo.
3. **Dado** dos rondas con cantidades distintas para el mismo artículo, **cuando** el Auditor lo abre, **entonces** ve cuánto contó cada persona y en qué ronda.
4. **Dado** un ítem en revisión, **cuando** el Auditor registra el reconteo, **entonces** puede hacerlo por voz o por texto con la misma mecánica del Operador.
5. **Dado** un reconteo registrado, **cuando** el Auditor intenta cerrar el caso, **entonces** el sistema exige un código de razón de un catálogo controlado.
6. **Dado** un ítem auditable, **cuando** el Auditor no encuentra el producto físicamente, **entonces** puede registrar cantidad cero con su código de razón.
7. **Dado** un reconteo del Auditor, **cuando** persiste la diferencia contra el sistema, **entonces** el valor del Auditor prevalece sobre el de los Operadores.
8. **Dado** el consolidado, **cuando** el Auditor lo revisa, **entonces** ninguna ronda aparece modificada ni fusionada: cada una conserva autor, momento y cantidades originales.
9. **Dado** un artículo auditable por *sin cobertura* —ninguna ronda afirmó nada sobre él—, **cuando** el Auditor lo recuenta, **entonces** su reconteo resuelve el artículo sin exigir una ronda adicional de Operador.
10. **Dado** una bodega con ítems auditables sin resolver, **cuando** se intenta cerrar el inventario, **entonces** el sistema lo impide.

### Edge cases

- **El Auditor no encuentra tampoco el producto** → cantidad cero con código de razón.
- **El Auditor coincide con una de las rondas** → igual debe registrar la causa; coincidir no exime de explicar.
- **Un mismo Auditor es también quien contó una de las rondas** → el sistema lo señala como conflicto de independencia y lo deja registrado en la traza.
- **Ítem auditable que resulta ser un error de catálogo** (unidad mal parametrizada) → se cierra con el código de razón correspondiente; corregir el catálogo maestro está fuera de alcance.
- **Reconteo que el propio Auditor quiere corregir** → se supersede como cualquier registro; no se sobrescribe.

### Requisitos verificables

- **FR-4.1**: El sistema MUST presentar al Auditor exclusivamente los ítems auditables.
- **FR-4.2**: El sistema MUST mostrar, por cada ítem auditable, el detalle por ronda y la diferencia contra lo esperado.
- **FR-4.3**: El sistema MUST permitir al Auditor registrar el reconteo por voz o por texto, con la misma mecánica del Operador.
- **FR-4.4**: El sistema MUST exigir un código de razón de un catálogo controlado antes de cerrar cualquier ítem auditable, y MUST NOT permitir ajustes sin causa registrada.
- **FR-4.5**: El sistema MUST tomar el reconteo del Auditor como valor final que prevalece sobre el de los Operadores.
- **FR-4.6**: El sistema MUST tratar el reconteo del Auditor como registro inmutable, superseded igual que cualquier otro.
- **FR-4.7**: El sistema MUST señalar y dejar en la traza el caso en que el Auditor haya ejecutado una de las rondas de la bodega que audita.
- **FR-4.8**: El sistema MUST impedir el cierre del inventario mientras existan ítems auditables sin resolver.
- **FR-4.9**: El sistema MUST restringir el acceso a la vista de auditoría al rol Auditor.

### Métricas de éxito

- **SC-4.1**: El Auditor ve y resuelve únicamente los ítems con diferencia; el 0% del inventario conciliado aparece en su vista.
- **SC-4.2**: El 100% de los ítems auditables cerrados tiene un código de razón asociado.
- **SC-4.3**: El 100% de los reconteos queda atribuido a su autor, con momento y modo de captura.
- **SC-4.4**: Ningún inventario puede cerrarse con ítems auditables pendientes.

### Supuestos y dependencias

- **Supuesto**: el reconteo del Auditor es el valor final e irrefutable que se envía al sistema central, sobrescribiendo el del Operador (`SPEC.md` §7).
- **Supuesto**: un solo Auditor por bodega es suficiente; no se exige doble auditoría.
- **Dependencia**: catálogo de códigos de razón definido por el negocio. El sistema no lo inventa.
- **Dependencia**: Historia 3 debe existir para determinar qué es auditable.

### Fuera de alcance de esta historia

- Corrección del catálogo maestro de artículos.
- Aprobación jerárquica del cierre por encima del Auditor.
- Envío al sistema central → Historia 7.

---

## Historia 5 — Productos fantasma (P5)

**Rol:** Operador registra; Auditor resuelve.

El Operador encuentra en el estante algo que no está en el catálogo. En vez de ignorarlo o anotarlo al margen como en el papel, lo registra: describe el producto en detalle y anota la unidad que observa. El ítem queda marcado como no registrado y pasa obligatoriamente al Auditor.

### Valor para el usuario

Es mercancía real que hoy se pierde del inventario. Para el Operador, deja de ser un problema sin casilla donde anotarse.

### Prueba independiente

El Operador registra un artículo inexistente en el catálogo; el sistema exige descripción detallada y unidad, lo marca como no registrado, y ese ítem aparece después entre los auditables.

### Escenarios de aceptación

1. **Dado** un artículo que no existe en el catálogo, **cuando** el Operador intenta registrarlo, **entonces** el sistema se lo permite y exige descripción detallada más unidad de medida observada.
2. **Dado** una descripción genérica o insuficiente, **cuando** el Operador intenta guardar, **entonces** el sistema la rechaza y le pide detalle.
3. **Dado** un producto fantasma registrado, **cuando** se consolida la bodega, **entonces** aparece siempre como auditable, sin importar cuántas rondas lo hayan registrado.
4. **Dado** un producto fantasma, **cuando** el sistema lo procesa, **entonces** NO le aplica validación de discrepancia, porque no existe saldo esperado contra el cual comparar.
5. **Dado** un producto fantasma registrado en dos rondas distintas, **cuando** se consolida, **entonces** el Auditor ve ambos registros con su descripción y autor.

### Edge cases

- **El producto fantasma sí existía en el catálogo, con otro nombre** → el Auditor lo resuelve con el código de razón correspondiente; unificar nombres en el catálogo maestro está fuera de alcance.
- **Descripción detallada que aun así es ambigua** → el sistema no juzga la calidad semántica más allá de los criterios objetivos de rechazo; la decisión queda en el Auditor.
- **Dos rondas describen el mismo hallazgo con palabras distintas** → se presentan ambos registros; el sistema no los fusiona automáticamente.

### Requisitos verificables

- **FR-5.1**: El sistema MUST permitir registrar artículos que no existen en el catálogo.
- **FR-5.2**: El sistema MUST exigir descripción detallada y unidad de medida observada, y MUST rechazar descripciones genéricas.
- **FR-5.3**: El sistema MUST marcar estos ítems como *producto no registrado* y MUST escalarlos siempre como auditables.
- **FR-5.4**: El sistema MUST NOT aplicar validación de discrepancia a un producto fantasma.
- **FR-5.5**: El sistema MUST NOT fusionar automáticamente hallazgos de rondas distintas.
- **FR-5.6**: El sistema MUST registrar autor, momento, modo de captura y bodega de cada producto fantasma.

### Métricas de éxito

- **SC-5.1**: El 100% de los productos fantasma registrados llega a la vista del Auditor.
- **SC-5.2**: El 0% de los productos fantasma se cierra automáticamente sin intervención humana.
- **SC-5.3**: El 100% de los productos fantasma tiene descripción que supera los criterios objetivos de detalle.

### Supuestos y dependencias

- **Supuesto**: los productos fantasma se reportan para decisión humana; el MVP no los da de alta en el catálogo maestro.
- **Supuesto**: existen criterios objetivos de "descripción detallada" (longitud mínima, prohibición de términos genéricos) que el negocio validará.
- **Dependencia**: Historia 1 para la mecánica de captura; Historia 4 para su resolución.

### Fuera de alcance de esta historia

- Alta del producto en el catálogo maestro o en el sistema central.
- Captura de fotografía del hallazgo.
- Deduplicación automática entre rondas.

---

## Historia 6 — Continuidad ante pérdida de red (P6)

**Rol:** Operador.

El Wi-Fi de la bodega falla a mitad del conteo. El Operador no pierde lo que ya contó ni tiene que adivinar por dónde iba: lo registrado se conserva en el dispositivo, el sistema reintenta cuando vuelve la red, y él continúa desde el último ítem grabado, viendo siempre sus últimos registros exitosos.

### Valor para el usuario

Es la diferencia entre una herramienta que funciona en la bodega real y una que funciona en la oficina. Sin esto, un microcorte obliga a repetir trabajo, y una herramienta que hace repetir trabajo se abandona.

### Prueba independiente

Se corta la red diez veces durante un conteo de 20 ítems; al restablecerla, todos los ítems confirmados antes de cada corte están registrados exactamente una vez, sin pérdidas ni duplicados, y el Operador continúa desde el siguiente.

### Escenarios de aceptación

1. **Dado** un conteo en curso, **cuando** se pierde la conexión, **entonces** el registro se conserva en el dispositivo y el sistema avisa que reintentará.
2. **Dado** la red restablecida, **cuando** se sincroniza, **entonces** el conteo se retoma desde el último ítem grabado con éxito.
3. **Dado** un mismo registro reenviado varias veces por reintentos, **cuando** llega al sistema, **entonces** queda registrado una sola vez.
4. **Dado** un conteo en curso, **cuando** el Operador mira la pantalla, **entonces** ve el historial de los últimos 3 a 5 productos registrados con éxito.
5. **Dado** un registro confirmado al Operador, **cuando** el dispositivo se apaga antes de sincronizar, **entonces** el registro sobrevive y se envía al volver a entrar.
6. **Dado** un registro pendiente de envío, **cuando** el Operador lo consulta, **entonces** distingue con claridad que está *guardado* pero aún *no validado*.
7. **Dado** un registro pendiente que al sincronizar genera una alerta de discrepancia, **cuando** llega la respuesta, **entonces** el Operador es notificado y debe resolverla antes de cerrar la ronda.

### Edge cases

- **Corte durante la selección de un candidato ambiguo** → la selección no se pierde; el ítem queda pendiente de confirmar, no descartado a medias.
- **Corte de red con el catálogo ya descargado** → el Operador sigue dictando y el sistema sigue resolviendo nombres localmente. Solo la validación contra el saldo esperado queda diferida.
- **El servidor resuelve el nombre distinto que el dispositivo** → no se corrige en silencio: el registro se marca para el Auditor con ambas resoluciones a la vista.
- **Dispositivo sin red durante toda la jornada** → fuera de alcance: el modelo es de microcortes, no de operación desconectada por jornadas completas.
- **Espacio de almacenamiento local agotado** → el sistema alerta antes de aceptar registros que no podrá conservar; nunca confirma lo que no puede garantizar.
- **Reloj del dispositivo desajustado** → el momento del registro se ancla a una referencia confiable, no al reloj local.
- **Registro pendiente cuya alerta de discrepancia llega tarde** → se le presenta al Operador aunque haya avanzado varios ítems.

### Requisitos verificables

- **FR-6.1**: El sistema MUST conservar cada registro en el dispositivo antes de intentar su envío.
- **FR-6.2**: Cada registro MUST portar una clave de idempotencia generada en el dispositivo, y el sistema MUST deduplicar por esa clave.
- **FR-6.3**: El sistema MUST retomar el conteo, tras una interrupción, en el ítem siguiente al último grabado con éxito.
- **FR-6.4**: El sistema MUST mostrar de forma permanente el historial de los últimos 3 a 5 productos registrados con éxito.
- **FR-6.5**: El sistema MUST distinguir de forma inequívoca en la interfaz un registro *guardado y pendiente de validar* de uno *validado*.
- **FR-6.6**: El sistema MUST NOT confirmar al usuario un registro que no pueda conservar de forma durable.
- **FR-6.7**: El sistema MUST notificar al Operador las alertas de discrepancia que lleguen de forma diferida y MUST exigir su resolución antes del cierre de la ronda.
- **FR-6.8**: El sistema MUST anclar el momento de cada registro a una referencia temporal confiable, no al reloj del dispositivo.
- **FR-6.9**: El sistema MUST resolver el nombre dictado contra el catálogo **sin depender de la red**, y MUST NOT impedir el registro de un conteo por no poder consultar el servidor. La resolución del servidor prevalece al sincronizar; si difiere de la local, el registro **MUST** marcarse para revisión del Auditor en vez de corregirse en silencio.

### Métricas de éxito

- **SC-6.1**: Cero registros perdidos y cero duplicados en una prueba con al menos 10 cortes de red durante un conteo.
- **SC-6.2**: El 100% de los registros pendientes se sincroniza al restablecerse la red, sin acción manual del Operador.
- **SC-6.3**: Un Operador puede identificar, en menos de 3 segundos y sin salir de la pantalla de conteo, cuáles de sus registros están pendientes de validación.

### Supuestos y dependencias

- **Supuesto**: la red de las bodegas es intermitente pero no permanentemente ausente.
- **Supuesto**: el dispositivo dispone de almacenamiento local suficiente para una jornada de conteo.
- **Dependencia**: Historia 1 para los registros que se conservan; Historia 2 para las alertas diferidas.

### Fuera de alcance de esta historia

- Operación totalmente desconectada por jornadas completas.
- Sincronización entre dispositivos de un mismo Operador.
- Resolución de conflictos entre dos dispositivos que envían la misma ronda.

---

## Historia 7 — Salida de datos e integración con el sistema central (P7)

**Rol:** usuario autorizado (el responsable del inventario cerrado).

Cerrado el inventario, el responsable descarga el consolidado en el formato que necesite, o deja que el sistema lo envíe directamente al sistema central sin que nadie vuelva a digitar nada.

### Valor para el usuario

Es el destino del dato y el punto donde se elimina la transcripción manual, que era el origen del problema. Sin esto, el sistema mejora el conteo pero no elimina la causa raíz.

### Prueba independiente

Con un inventario cerrado, un usuario autorizado descarga el consolidado en CSV y en Excel, y el envío al sistema central se ejecuta, confirma y deja rastro.

### Escenarios de aceptación

1. **Dado** un inventario cerrado, **cuando** un usuario autorizado solicita el reporte, **entonces** puede escoger entre CSV y Excel y descargar el consolidado.
2. **Dado** cualquier registro exportado, **cuando** se revisa, **entonces** identifica el artículo por su nombre e incluye el código de producto cuando existe.
3. **Dado** un inventario auditado, **cuando** se envía al sistema central, **entonces** el sistema confirma el resultado y deja rastro de qué se envió, cuándo y por quién.
4. **Dado** un envío que falla, **cuando** se reintenta, **entonces** no se duplican movimientos en el sistema central.
5. **Dado** un inventario con ítems auditables sin resolver, **cuando** se intenta exportar o enviar como definitivo, **entonces** el sistema lo impide.
6. **Dado** el consolidado exportado, **cuando** se revisa, **entonces** distingue el valor final de cada artículo, su origen (conciliado por conteo ciego o resuelto por el Auditor) y el código de razón cuando aplique.
7. **Dado** un usuario sin autorización, **cuando** intenta descargar el reporte, **entonces** el sistema se lo niega.

### Edge cases

- **Sistema central no disponible al momento del envío** → el envío queda pendiente y reintenta; el inventario no se pierde ni se bloquea.
- **Envío parcialmente aceptado por el sistema central** → se registra qué se aceptó y qué no; nunca se marca como completo un envío parcial.
- **Reintento tras un envío cuyo resultado se desconoce** → la referencia única del envío evita el doble movimiento.
- **Bodega sin ningún movimiento respecto al saldo esperado** → se exporta igual, dejando constancia de que el inventario se ejecutó.

### Requisitos verificables

- **FR-7.1**: El sistema MUST identificar cada artículo por su nombre e incluir el código de producto cuando exista.
- **FR-7.2**: El sistema MUST permitir a usuarios autorizados descargar el consolidado final en CSV y en Excel.
- **FR-7.3**: El sistema MUST ofrecer una vía de integración dedicada que traslade el resultado al sistema central de inventarios sin digitación manual.
- **FR-7.4**: El sistema MUST garantizar que un reenvío no duplique movimientos en el sistema central.
- **FR-7.5**: El sistema MUST dejar rastro auditable de qué se exportó o envió, cuándo y por quién.
- **FR-7.6**: El sistema MUST impedir la exportación definitiva o el envío de un inventario con ítems auditables sin resolver.
- **FR-7.7**: El consolidado exportado MUST indicar, por artículo, el valor final, su origen y el código de razón cuando aplique.
- **FR-7.8**: El sistema MUST restringir la exportación y el envío a usuarios autorizados.
- **FR-7.9**: El sistema MUST NOT escribir en el sistema central ningún valor derivado de un conteo de Operador sin el aval del Auditor. La actualización del inventario original ocurre **únicamente** tras el cierre avalado (D8).

### Métricas de éxito

- **SC-7.1**: El consolidado final llega al sistema central sin ninguna transcripción manual intermedia.
- **SC-7.2**: Cero movimientos duplicados en el sistema central tras reintentos de envío.
- **SC-7.3**: El 100% de los envíos y exportaciones queda registrado con autor, momento y contenido.
- **SC-7.4**: El 100% de los artículos del consolidado exportado indica el origen de su valor final.

### Supuestos y dependencias

- **Supuesto**: el valor final de un artículo es el del Auditor cuando hubo reconteo, y el valor coincidente de las rondas cuando quedó conciliado.
- **Dependencia**: acceso a la vía de integración del sistema central de inventarios, identificado en `SPEC.md` §6 como Oracle Fusion Cloud Inventory Management. Se gestiona como dependencia externa del proyecto.
- **Dependencia**: Historias 3 y 4 para producir un inventario cerrado.

### Fuera de alcance de esta historia

- Ajustes contables posteriores al envío.
- Traslados entre bodegas y órdenes de compra.
- Programación automática de envíos recurrentes.

---

## Historia 8 — Administración de tolerancias de merma (P8)

**Rol:** Administrador.

El Administrador ajusta puntualmente el porcentaje de merma aceptado para los productos medidos por peso, sin depender de un desarrollo.

### Valor para el usuario

Evita que un cambio de una línea en una tabla dependa del equipo técnico. Hasta que exista, el sistema opera con las tolerancias cargadas inicialmente.

### Prueba independiente

El Administrador cambia la tolerancia; se cuenta un artículo con una diferencia que antes alertaba y ahora no —o al revés— y el comportamiento refleja el cambio.

### Escenarios de aceptación

1. **Dado** un Administrador autenticado, **cuando** entra al panel, **entonces** puede consultar y modificar las tolerancias de merma.
2. **Dado** un usuario con rol Operador o Auditor, **cuando** intenta entrar al panel, **entonces** el sistema se lo niega.
3. **Dado** una tolerancia modificada, **cuando** se registra un conteo posterior, **entonces** la validación usa el valor vigente al momento del conteo.
4. **Dado** un conteo ya registrado, **cuando** la tolerancia cambia después, **entonces** ese conteo NO se revalúa retroactivamente.
5. **Dado** cualquier cambio de tolerancia, **cuando** se guarda, **entonces** queda registrado quién lo hizo y cuándo.
6. **Dado** un valor de tolerancia inválido (negativo o desproporcionado), **cuando** se intenta guardar, **entonces** el sistema lo rechaza.

### Edge cases

- **Cambio de tolerancia con rondas abiertas** → los conteos ya registrados conservan la tolerancia con la que se evaluaron; los nuevos usan la vigente.
- **Tolerancia fijada en cero** → válido: significa que cualquier diferencia alerta.
- **Artículo cuya unidad deja de ser de peso** → la tolerancia deja de aplicar sin necesidad de reconfigurar.

### Requisitos verificables

- **FR-8.1**: El sistema MUST permitir al Administrador, y solo a él, consultar y modificar las tolerancias de merma.
- **FR-8.2**: El sistema MUST aplicar la tolerancia vigente al momento del conteo y MUST NOT revaluar retroactivamente conteos ya registrados.
- **FR-8.3**: El sistema MUST registrar autor y momento de cada cambio de configuración.
- **FR-8.4**: El sistema MUST validar los valores de tolerancia y rechazar los inválidos.
- **FR-8.5**: El sistema MUST conservar el historial de cambios de tolerancia.

### Métricas de éxito

- **SC-8.1**: El 100% de los cambios de tolerancia queda atribuido a un autor con su momento.
- **SC-8.2**: El 0% de los conteos registrados cambia de resultado por una modificación posterior de tolerancia.
- **SC-8.3**: Un Administrador completa un cambio de tolerancia en menos de 2 minutos sin asistencia técnica.

### Supuestos y dependencias

- **Supuesto**: los cambios de tolerancia son puntuales y esporádicos, no una operación de alto volumen.
- **Dependencia**: valores iniciales de tolerancia provistos por el negocio.

### Fuera de alcance de esta historia

- Tolerancias diferenciadas por bodega o por artículo individual (el MVP las maneja por unidad de medida).
- Flujo de aprobación de cambios de configuración.
- Administración de usuarios y roles.

---

## Qué historia se puede ver funcionando

Dónde se demuestra cada historia en la aplicación construida. La columna «dónde» son rutas reales de `frontend/app/`; la aplicación llama **Afiliado** al rol que la especificación llama **Operador**.

| Historia | Dónde se ve | Qué se demuestra |
|---|---|---|
| **1** · Conteo ciego en ronda propia | `/` (entrada), `/afiliado`, `/afiliado/conteo`, `/afiliado/resumen` | Entrada por documento con rol deducido, selección de bodega con aviso de quién más está contando, dictado con candidatos cuando el catálogo no resuelve solo, aviso de artículo duplicado, y cierre de ronda desde el resumen |
| **2** · Validaciones y alerta de discrepancia | `/afiliado/conteo` (diálogo de validación), `/afiliado/resumen` | La alerta que pregunta sin revelar el saldo, y el bloqueo del cierre mientras haya alertas sin responder |
| **3** · Consolidación y clasificación | **Sin pantalla propia.** Se ve por su resultado en `/auditor/verificar` (la cola de auditables con su motivo) y `/auditor/reporte` (el consolidado completo) | Es el motor: clasifica en conciliado/auditable. No hay interfaz que lo ejecute — se dispara al cerrar rondas |
| **4** · Reconteo del Auditor | `/auditor`, `/auditor/verificar`, `/auditor/reporte` | Bodegas con su número de pendientes, el caso abierto con saldo esperado y detalle por ronda, reconteo y cierre con código de razón del catálogo controlado |
| **5** · Productos fantasma | `/afiliado/conteo` (reportar hallazgo), `/auditor/verificar`, `/admin/detalle` (filtro «Sin catálogo») | El hallazgo sin catálogo se registra, escala a auditable y aparece en el reporte detallado |
| **6** · Continuidad ante pérdida de red | `/afiliado/conteo` y `/afiliado/resumen` (estado por registro: pendiente / rechazado) | Cola local y estado visible por registro. **No tiene pantalla propia**: se demuestra cortando la red durante el conteo |
| **7** · Salida de datos e integración | `/auditor/reporte` (botón «Descargar consolidado») | Descarga del consolidado y cierre que actualiza los saldos. El formato disponible es **CSV** (y JSON por API); **Excel no está expuesto en pantalla** |
| **8** · Administración de tolerancias de merma | **NO tiene pantalla.** No existe ninguna ruta de administración de merma en `frontend/app/` | Las tolerancias operan con los valores cargados inicialmente, tal como anticipa la propia historia: «hasta que exista, el sistema opera con las tolerancias cargadas inicialmente» |

**Pantallas sin historia asociada.** `/admin`, `/admin/historia` y `/admin/autopulido` no corresponden a ninguna de las ocho historias: son el tablero de gestión y el auto-pulido, especificados en [`05-tablero/diseno-del-tablero.md`](../05-tablero/diseno-del-tablero.md). `/admin/detalle` sí sirve de evidencia de la Historia 5 por su filtro de artículos sin catálogo.
