# Requisitos para el cliente web

**Para:** quien construye el frontend · **De:** el equipo de backend · **Fecha:** 2026-07-25

El contrato de la API está en [`contracts/openapi.yaml`](./contracts/openapi.yaml) y los tipos en el paquete `@cci/contracts`. Eso resuelve *qué* se llama y *con qué forma*.

Este documento es lo otro: **cuatro comportamientos que no se ven en el contrato y que, si nadie los pide explícitamente, no aparecen.** No son detalles de implementación — son requisitos con criterio de aceptación, y cada uno corresponde a una tarea del plan.

**API:** `https://d1jhay4xdswind.cloudfront.net`

---

## F-18 · Durabilidad antes que red

**El registro se escribe en el dispositivo ANTES de intentar enviarlo.** La confirmación al operario se emite cuando el dato es durable *localmente*, no cuando el servidor responde.

Es la Restricción 2 de la Constitución, y es lo que evita perder un conteo por un microcorte de Wi-Fi. También es lo que hace alcanzable el presupuesto de 1.500 ms: si la confirmación esperara a la red, el número dependería de la calidad del enlace de la bodega.

**Cómo:** IndexedDB como *write-ahead log*. Escribir → confirmar al usuario → encolar el envío. Cada registro lleva una `claveIdempotencia` (UUID) **generada en el dispositivo**, no pedida al servidor. El servidor deduplica por ella, así que reenviar es seguro: ya está probado del lado nuestro.

> ⚠️ **Matiz que decide si esto sirve o no.** La confirmación local dice *"quedó registrado"*, **no** *"el sistema validó tu conteo"*. La alerta de discrepancia es una decisión del servidor y llega después. Si la interfaz mezcla los dos momentos, el operario creerá aprobado un conteo que todavía no lo está — y eso es peor que no confirmar nada.

**Se acepta cuando:** se corta la red diez veces durante un conteo de 20 ítems y, al restablecerla, los 20 están registrados **exactamente una vez**: cero pérdidas y cero duplicados.

---

## F-21 · El catálogo se cachea; el saldo esperado jamás

El Service Worker debe cachear el app shell y **el catálogo de la bodega**, que se descarga al abrir la ronda.

Cachear el catálogo es obligatorio, no una optimización: sin él en el dispositivo, F-21b es imposible.

**Lo que NUNCA se cachea, ni se guarda, ni se recibe: el saldo esperado.** Las respuestas dirigidas al Operador no lo traen —eso lo garantizamos nosotros— pero tampoco puede derivarse ni inferirse en el cliente. El catálogo que servimos en `GET /rondas/{id}/catalogo` no lo contiene, a propósito.

**Se acepta cuando:** tras una sesión completa de conteo, una inspección de `localStorage`, `sessionStorage`, IndexedDB y la caché del Service Worker no encuentra el saldo esperado de ningún artículo, ni el valor, ni un rango, ni nada de lo que se derive.

---

## F-21b · Resolver el nombre sin red

Cuando el operario dicta *"aceite de oliva, tres litros"*, hay que resolver ese nombre contra el catálogo. **Esa resolución corre en el dispositivo.**

Si dependiera de la red, un microcorte impediría contar — no solo enviar, sino contar. Eso contradice la Historia 6 y la Restricción 5.

**Dos umbrales, no uno:**

1. **Aceptación** — el mejor candidato debe superar un puntaje mínimo.
2. **Margen** — debe además sacarle distancia suficiente al segundo.

Si el margen es estrecho, **se muestran candidatos aunque el primero supere el umbral de aceptación**. El sistema no elige en caso de duda: pregunta (`FR-1.11`, `FR-1.27`).

El catálogo real lo hace concreto: hay `ACEITE`, `ACEITE DE OLIVA`, `ACEITE DE AJONJOLI` y `ACEITE DE OLIVA 10ML /BOLS` en la misma bodega. *"Aceite"* a secas no puede resolverse solo.

El servidor **vuelve a resolver** al recibir el registro y es la autoridad. Si su resolución difiere de la local, el registro **no se corrige en silencio**: se marca para el Auditor con las dos a la vista (`FR-6.9`).

**Se acepta cuando:** con el Wi-Fi apagado y el catálogo ya descargado, el operario puede seguir dictando y el sistema sigue resolviendo nombres. Solo la validación contra el saldo queda diferida.

**Escala real, para dimensionar:** los catálogos por bodega van de 55 a 344 artículos. Cabe de sobra en memoria.

---

## F-22 · *Guardado* y *validado* no se pueden confundir

Un registro puede estar guardado localmente pero aún no validado por el servidor. **La diferencia tiene que ser visible sin esfuerzo.**

Si se mezclan, el operario cree aprobado lo que todavía no lo está, sigue caminando, y la alerta le llega cinco artículos después sin contexto.

Estados que el cliente debe distinguir: **pendiente de envío** · **enviado, esperando validación** · **validado sin alerta** · **con alerta sin resolver**.

**Se acepta cuando:** un operario identifica en menos de 3 segundos, sin salir de la pantalla de conteo, cuáles de sus registros están pendientes de validación (`SC-6.3`).

---

## F-30 · Confirmación audible **y** visual, siempre las dos

Cada registro exitoso se confirma por voz con `speechSynthesis` del navegador (`es-CO`, con reserva a `es-419`) **y en pantalla, en paralelo**. Nunca una sola.

El operario trabaja de pie, con las manos ocupadas, con ruido y a veces con guantes — la confirmación audible es lo que le permite seguir caminando sin mirar el dispositivo. Pero **la visual no es opcional ni un respaldo**: es requisito de accesibilidad (`FR-1.8`) y lo único que funciona cuando la bodega está ruidosa o el operario no oye bien.

**Se lee el número dígito a dígito.** "Veinte kilos" y "ocho kilos" suenan parecido en una bodega; "dos, cero, kilos" no se confunde con nada.

`speechSynthesis` es gratis, funciona sin red y no añade latencia — por eso está en el presupuesto de 1.500 ms con 250 ms y no un TTS en la nube.

**Se acepta cuando:** el 100% de los registros produce ambas confirmaciones, y el flujo completo de conteo se puede recorrer con lector de pantalla activo y con una sola mano.

> Si la calidad de voz resulta mala en el parque real de dispositivos, la salida es TTS en la nube **pregenerado y cacheado por artículo** — el catálogo es finito, así que se sintetiza una vez y se reproduce desde caché. No es un cambio de arquitectura; avisá y lo montamos.

## F-34 · La alerta de validación (nuevo, Slice 2)

Cada `POST /rondas/:id/registros` responde ahora con un campo `validacion`:

```json
{ "registroId": "…", "secuencia": 1, "recibidoEn": "…",
  "validacion": { "resultado": "alerta_discrepancia",
                  "unidadCorrecta": null, "exigeEvidencia": false } }
```

`resultado` es uno de `aceptado` · `alerta_unidad` · `alerta_discrepancia` ·
`no_validable` · `sin_verificacion`.

Tres cosas que la pantalla **no** puede hacer, y la razón:

1. **No inventes la dirección.** El servidor sabe si sobra o falta y no lo dice.
   Nada de "parece que falta" ni flechas: con la dirección, un operario
   encuentra el saldo del sistema por bisección en diez intentos, y ahí se cae
   la ceguera entera.
2. **No repitas el envío para "reintentar la validación".** A la tercera
   verificación del mismo artículo el servidor responde `sin_verificacion` y
   deja de opinar. Es a propósito.
3. **En `alerta_unidad`, `unidadCorrecta` sí viene** y se muestra: es dato del
   catálogo que ya tenés cacheado, no el saldo.

La alerta es **una pregunta**: "¿seguro que contaste eso?" con dos salidas —
*corregir* (nuevo envío con `confirmaCorreccion: true`) o *sostener* (nuevo
envío con `confirmaPeseAAlerta: true`).

**Sostener obliga a subir el audio.** La respuesta trae `exigeEvidencia: true` y
el conteo queda con marca de advertencia; después, cuando haya red:

```
POST /rondas/:rondaId/registros/:registroId/evidencia
{ "claveS3": "audio/<ronda>/<registro>.webm", "claveIdempotencia": "<uuid>" }
```

**Sin ese POST la ronda no cierra.** `GET /cuadre-cierre` trae ahora un array
`bloqueos` —con `articuloId`, `nombre`, `registroId` y `motivo`
(`alerta_sin_responder` o `evidencia_faltante`)— que sale de la misma regla que
aplica el bloqueo, así que podés pintar exactamente lo que falta antes de que
el operario intente cerrar y se lleve un 400.

**Se acepta cuando:** una alerta de discrepancia y una de unidad se resuelven
por las dos vías (corregir y sostener), y la ronda cierra tras adjuntar la
evidencia — sin que en ninguna pantalla aparezca un número que venga del ERP.

## F-35 · Sin red (nuevo, Slice 6)

El backend ya hace su mitad: deduplica por tu clave, guarda todo y sabe decirte
por dónde ibas. Lo que sigue siendo tuyo:

**Escribe antes de enviar.** Genera la `claveIdempotencia` (UUID v4) y guarda el
registro en IndexedDB **antes** de intentar el `fetch`. El envío es un reintento
contra esa cola, con backoff. Probado del lado del servidor: 20 ítems con 10
cortes y 8 reintentos simultáneos del mismo sobre dan una fila cada uno.

**No acumules audio.** La transcripción va directo a Deepgram por WebSocket; sin
red no hay voz. Grabar minutos para transcribir después sería peor: el operario
no sabría hasta el final si el sistema le entendió. Sin red se dicta por teclado
y la gramática local (`@cci/gramatica`) resuelve igual con el catálogo cacheado.

**Manda el texto crudo en `textoDictado`.** Es nuevo y **importa**: el servidor
vuelve a resolver el nombre con el catálogo vigente y, si le da otro artículo,
marca el registro para el Auditor con las dos resoluciones. Sin ese campo el
servidor tiene que creerle a un catálogo cacheado que puede estar viejo. Nunca
corrige en silencio, así que mandarlo no te cambia el `articuloId`: solo evita
que un desajuste pase inadvertido.

**Retomar y refrescar:**

```
GET /rondas/:rondaId/estado
→ { contados, total,
    ultimos: [{ articuloId, nombre, cantidad, estado, validacion, recibidoEn }],
    pendientesDeResolver: [{ registroId, articuloId, nombre, motivo }] }
```

- `ultimos` (3–5, el más reciente primero) es el historial permanente en
  pantalla y el punto por donde retomar. **Úsalo al volver a entrar**: la
  memoria del dispositivo se pierde y el operario no puede quedar adivinando.
- `validacion` es lo que distingue *guardado* de *validado* (F-22). `null` o
  ausente = todavía no llegó respuesta.
- `pendientesDeResolver` son las **alertas diferidas**: llegaron mientras el
  operario ya iba en otro estante. Muéstralas apenas aparezcan; si espera al
  cierre, se entera con la ronda entera hecha.
- **Sin saldos.** Esta respuesta la lee un Operador y hay una prueba que la
  recorre valor por valor.

**Almacenamiento agotado (FR-6.6).** Antes de aceptar un registro, comprueba
cuota (`navigator.storage.estimate()`). Si no cabe, **avisa y bloquea**: nunca
confirmes al operario algo que no puedes conservar. Es la única parte de todo
esto donde el backend no puede ayudarte.

**Se acepta cuando:** 20 ítems con 10 cortes de red dan 20 registros y ningún
duplicado; cerrar el navegador a mitad y volver a entrar deja al operario en el
ítem siguiente; y una alerta diferida aparece en pantalla sin que él la busque.

## F-36 · El vocabulario viene en la credencial (nuevo)

`POST /voz/token/:rondaId` devuelve ahora, dentro de `opciones`, el **vocabulario
de la bodega**: los nombres del catálogo, como `keyterm`.

**Pásalos tal cual a la conexión con Deepgram.** No es cosmético: el
transcriptor decide entre "acelga" y "aceite" con un modelo general del
español; con el catálogo delante decide entre las palabras que de verdad pueden
aparecer en esa bodega. Es la mejora de reconocimiento más barata que tiene el
sistema, y el dato ya existía.

Mándalos **todos los de `opciones`**, sin filtrar ni reordenar — el servidor ya
recortó y priorizó (los nombres largos son los que un modelo general acierta
peor; "SAL" y "ARROZ" no necesitan ayuda).

> Ojo: los keyterms **no** ayudan con los números. Para "34 vs 24" la defensa
> es la relectura dígito a dígito de F-30, que es tuya.

## Un detalle que cuesta media hora encontrar

`POST /integracion/bodegas/:id/cierre` y `POST .../envio` **no llevan cuerpo**.
No les pongas `content-type: application/json` sin body: Fastify responde 400
—"Body cannot be empty"— y parece un fallo del servidor. O mandas cuerpo, o no
mandas la cabecera.

## Lo que el backend ya te da resuelto

| | |
|---|---|
| `GET /tiempo` | Referencia temporal del servidor. **Pídela al abrir la ronda** y ancla `capturadoEn` contra ella, no contra el reloj del dispositivo (`FR-6.8`, D-16) |
| Idempotencia | Probada con 10 reintentos simultáneos: se guarda una vez y el reintento recibe la misma respuesta que el envío original |
| Sesión | Cookie `HttpOnly; Secure; SameSite=Strict`. **No la leas por JavaScript, no se puede.** Solo `credentials: 'include'` en cada `fetch` |
| Autorización | Negada por defecto en el servidor. El rol que devuelve `POST /sesion` sirve para decidir **qué pintas**, jamás qué permites |
| Errores | Todos con `{ codigo, mensaje }`. Los de validación traen `detalles.errores[]` con campo y motivo |

## Usuarios de prueba

Clave `Inventario2026*` para los tres:

| Documento | Rol |
|---|---|
| `1000000001` | Operador |
| `1000000002` | Auditor |
| `1000000003` | Administrador |

## Una advertencia sobre la red

El puerto directo de la instancia (`:3000`) lo bloquea el filtro web de algunas redes corporativas. **Usá siempre la URL de CloudFront**, que va por 443 con certificado válido. Además la PWA lo necesita: un Service Worker exige contexto seguro.
