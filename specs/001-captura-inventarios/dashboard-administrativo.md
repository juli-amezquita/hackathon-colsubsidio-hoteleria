# Dashboard Administrativo Final

**Captura Inteligente de Inventarios · Colsubsidio**
Respuesta al encargo de diseño del tablero de cierre mensual.

---

## 1 · Resumen

El encargo pedía diseñar la estructura y los requerimientos de datos de un tablero de cierre mensual con tres bloques. El tablero **ya está construido y en el repositorio**: siete endpoints, cuatro pantallas y un modelo de datos nuevo para que el mes sea la unidad de trabajo. Este documento describe lo que existe, justifica cada decisión y dice qué falta.

### Qué se entrega

| Bloque del encargo | Estado | Dónde vive |
|---|---|---|
| 1 · KPI agregados por bodega y global | Construido | `GET /metricas/resumen` → `/admin` |
| 2 · Reporte detallado (tabla granular) | Construido | `GET /metricas/detalle` → `/admin/detalle` |
| 3 · Análisis temporal (12 meses, por bodega y por producto) | Construido | `GET /metricas/historia`, `GET /metricas/articulo` → `/admin/historia` |
| Informe comparativo entre bodegas | Construido | Mismo `/metricas/resumen`, barras apiladas ordenables |
| Valor del ajuste contable | **Estructura lista, sin datos** | Ver §6.1 |
| Histórico de 12 meses con datos reales | **Se llena con el uso** | Ver §6.2 |
| Bloque extra: auto-pulido del sistema | Construido | `GET /metricas/autopulido` → `/admin/autopulido` |

### Las tres decisiones que explican todo lo demás

1. **Se cuentan referencias, no unidades.** El cliente lo subrayó y cambia cada consulta: 300 panes faltantes son *una* referencia con faltante, no 300. Está escrito en el código (`metricas.service.ts:15-18`) y en pantalla (`frontend/app/admin/page.tsx:189-200`), no solo en el manual.

2. **El histórico sale de una foto, no de la proyección viva.** `articulo_consolidado` se recalcula entera cada vez que cierra una ronda: preguntarle por enero en marzo devuelve *lo que se concluiría hoy*, no lo que se avaló entonces. Por eso existe `consolidado_historico`, que se escribe una vez en el instante del aval y no se retoca nunca (`0016_periodos.up.sql:51-108`, `REVOKE UPDATE, DELETE` en la línea 134).

3. **El mes en curso se puede mirar antes de cerrarlo, y se marca.** El encargo lo plantea como informe de cierre, y lo es. Pero negarle a la gerencia ver cómo va el mes porque nadie ha firmado sería una limitación del sistema, no del negocio. Cada bodega viaja con su `fuente`: `cierre` cuando está avalada, `proyeccion` cuando todavía se mueve, y la pantalla lo estampa (`marco.tsx:206-218`).

### Qué NO se entrega

- **Pesos.** El maestro del cliente no trae precios. La tabla `costo_articulo` existe y nace vacía; el tablero declara la cobertura de costos en vez de sumar ceros y llamarlo un total. §6.1.
- **Doce meses de historia poblada.** El sistema aún no ha cerrado ningún mes. La serie se llena con cada cierre y no se puede rellenar hacia atrás sin inventar. §6.2.
- **Las 48 bodegas.** El archivo trae una lista de 48 nombres y ocho hojas de stock que no emparejan con ellos. Hoy existen las 8 con datos. §6.3.

---

## 2 · Los tres bloques

### Superficie completa

Todos los endpoints cuelgan de `/metricas` (`apps/api/src/modules/metricas/metricas.controller.ts`).

| Endpoint | Línea | Parámetros | Bloque |
|---|---|---|---|
| `GET /metricas/periodos` | `:29-33` | — | Filtros |
| `GET /metricas/resumen` | `:36-40` | `periodo=AAAA-MM` | 1 |
| `GET /metricas/detalle` | `:43-65` | `periodo`, `bodega`, `estado`, `q`, `limite`, `desde` | 2 |
| `GET /metricas/historia` | `:68-72` | `meses` (1–36, por defecto 12), `bodega` | 3 |
| `GET /metricas/articulo` | `:75-82` | `codigo` \| `nombre` | 3 |
| `GET /metricas/causas` | `:85-89` | `periodo`, `bodega` | Extra |
| `GET /metricas/autopulido` | `:96-100` | `periodo` | Extra |

**Roles.** Las siete rutas llevan `@Roles('administrador', 'auditor', 'supervisor')`. Ninguna admite al Operador, y no por descuido: todo lo que hay aquí son diferencias contra el saldo del sistema, exactamente lo que FR-1.18 prohíbe que vea quien cuenta. La guarda es negada por defecto (`platform/autorizacion/decoradores.ts:5-17`), así que el olvido produce un 403 y no una fuga.

**Aislamiento por bodega.** *Todas* las consultas —sin excepción— llevan `JOIN usuario_bodega ub ON ub.bodega_id = b.id AND ub.usuario_id = ${usuarioId}` (`metricas.service.ts:133, 159, 207, 258, 313, 382, 409`). Sin ese join, un agregado «de todas las bodegas» le entregaría a un auditor de una sede las diferencias de las 47 restantes por la puerta de atrás, sin necesidad de adivinar ningún UUID.

**Validación de entrada.** `periodo` se valida contra `/^\d{4}-(0[1-9]|1[0-2])$/` y `bodega` contra el patrón de UUID (`metricas.controller.ts:110-133`). Los parámetros van ligados, así que no había riesgo de inyección; lo que se evita es un `date` inválido que devuelva un 500 con traza de Postgres en vez de un 400 que diga qué se esperaba.

---

### Bloque 1 · KPI y métricas agregadas

**Qué pidió el cliente.** Total de referencias contadas, con diferencias iniciales, aclaradas por el auditor, con faltantes reales (merma), con sobrantes reales y «fantasma». Por bodega y global. Más el informe comparativo: ítems contados, sin diferencias, con diferencias y valor del ajuste contable.

**Endpoint.** `GET /metricas/resumen?periodo=2026-07` → `{ periodo, global, bodegas[] }` (`metricas.service.ts:147-219`).

**La consulta.** Hay dos fuentes que producen exactamente las mismas columnas:

```sql
-- A · La foto, para bodegas que ya cerraron el mes (service:150-162)
SELECT b.id AS bodega_id, b.nombre AS bodega, ci.cerrado_en, <AGREGADOS>
FROM consolidado_historico x
JOIN bodega b             ON b.id = x.bodega_id
JOIN cierre_inventario ci ON ci.id = x.cierre_id
JOIN usuario_bodega ub    ON ub.bodega_id = b.id AND ub.usuario_id = $1
WHERE x.periodo = '2026-07-01'
GROUP BY b.id, b.nombre, ci.cerrado_en
ORDER BY b.nombre

-- B · La proyección viva, SOLO si el periodo pedido es el mes en curso (service:172-211)
--     articulo_consolidado + producto_fantasma, unidas por UNION ALL, con
--     LEFT JOIN costo_articulo y LEFT JOIN discrepancia (estado='cerrada').
```

La proyección solo se consulta cuando `periodo` es el mes actual en hora de Bogotá (`service:169-174`). Preguntarle por marzo estando en julio devolvería el estado de hoy etiquetado como marzo, que es justo la confusión que este módulo existe para evitar. Las bodegas que ya tienen cierre se excluyen de la proyección (`service:215`).

**La definición de cada KPI se escribe una sola vez** en la función `AGREGADOS()` (`service:452-476`), que las dos fuentes interpolan idéntica. Duplicarla garantizaría que algún día las dos pantallas del mismo mes mostraran cifras distintas y nadie supiera cuál creer. El detalle campo por campo está en §5.

**Qué gráfico se eligió: barras apiladas horizontales, una por bodega** (`components/admin/graficos.tsx:43-91`).

| Alternativa | Por qué no |
|---|---|
| Torta / donut por bodega | Una torta responde «cómo se reparte *esta* bodega». La pregunta del cliente es comparar bodegas *entre sí*, y ocho tortas no se comparan: el ojo humano no estima ángulos bien. |
| Barras verticales | Los nombres de bodega son largos (`STOCK RESTAURANTE FUENTES SUMIN`). En vertical hay que girarlos 45° o recortarlos. Horizontal deja el rótulo en su renglón. |
| Barras agrupadas (una por KPI) | Los tramos suman el total (`contadas`). Apiladas se lee la composición **y** el total en la misma marca; agrupadas se pierde el total. |
| Un solo número por bodega | Esconde que una bodega con 200 diferencias sobre 2.000 referencias lo hace mejor que una con 50 sobre 100. Por eso cada barra lleva su precisión al lado (`app/admin/page.tsx:160`). |

Detalles que importan:

- **El orden nunca es alfabético.** Dos botones: «Más diferencias» y «Peor precisión» (`app/admin/page.tsx:50-62, 434-450`). Un comparativo ordenado por nombre obliga a leerlo entero para descubrir lo único que importaba.
- **El quinto tramo, «sin resolver», se deriva restando** y no se toma del contador `pendientes` del servidor (`app/admin/page.tsx:411-432`). `pendientes` es una marca transversal que se solapa con faltantes y sobrantes; sumarlo daría más que `contadas` y la barra dejaría de cuadrar consigo misma. Una barra apilada solo admite tramos disjuntos.
- **Separador de 2 px entre tramos** (`graficos.tsx:69-70`): sin él, dos colores contiguos se leen como un degradado.
- **Cada barra lleva `role="img"` y un `aria-label`** con las cifras en texto (`graficos.tsx:72-73`). Un lector de pantalla no ve el SVG.

**El ajuste contable** tiene su propio bloque (`app/admin/page.tsx:212-269`) y su propia letra pequeña, porque hoy es la cifra que no existe. Ver §6.1.

---

### Bloque 2 · Reporte detallado

**Qué pidió el cliente.** Código SKU, nombre, unidad de medida, cantidad física inventariada, cantidad esperada (sistema), diferencia neta y estado de validación.

**Endpoint.** `GET /metricas/detalle?periodo=&bodega=&estado=&q=&limite=&desde=` (`metricas.service.ts:228-288`).

**La consulta.**

```sql
SELECT h.codigo, h.nombre, h.unidad, b.nombre AS bodega,
       h.cantidad_final, h.saldo_sistema, h.diferencia,
       h.clasificacion, h.motivo, h.codigo_razon_id, h.origen_valor,
       h.valor_ajuste, h.fantasma_id IS NOT NULL AS es_fantasma,
       count(*) OVER ()::int AS total          -- el total viaja con la página
FROM consolidado_historico h
JOIN bodega b          ON b.id = h.bodega_id
JOIN usuario_bodega ub ON ub.bodega_id = b.id AND ub.usuario_id = $1
WHERE h.periodo = $2
  [AND h.bodega_id = $3]
  [AND (lower(h.nombre) LIKE $4 OR lower(coalesce(h.codigo,'')) LIKE $4)]
  [AND h.diferencia < 0]                       -- estado=faltante
  [AND h.diferencia > 0]                       -- estado=sobrante
  [AND (h.diferencia <> 0 OR h.motivo = 'discrepancia')]  -- estado=diferencia
  [AND h.fantasma_id IS NOT NULL]              -- estado=fantasma
  [AND h.motivo = 'sin_cobertura']             -- estado=sin_cobertura
ORDER BY abs(coalesce(h.diferencia, 0)) DESC, h.nombre
LIMIT $5 OFFSET $6
```

`count(*) OVER ()` devuelve el total en la misma pasada: sin él harían falta dos consultas y podrían discrepar entre sí.

**El orden es por magnitud de la diferencia, descendente.** Lo que la gerencia quiere ver primero es lo que más se movió, no lo que empieza por A.

**Paginación de verdad.** `limite` se acota a 50 por defecto y 500 como tope duro (`metricas.controller.ts:62`): un `limite=999999` en la barra de direcciones no debe poder pedirle 60.000 filas a Postgres. Son 1.421 artículos en las ocho hojas del cliente y van 48 bodegas; traerlo entero funciona hoy y deja de funcionar exactamente el mes en que el sistema empiece a servir para algo.

**Qué se eligió: tarjetas, no tabla** (`app/admin/detalle/page.tsx:238-333`).

Es la excepción al «una tabla es mejor que un párrafo». Siete columnas no caben en un móvil, y una tabla con desplazamiento lateral esconde justo la columna que importa —la diferencia— detrás de un gesto que nadie hace en una bodega con el teléfono en una mano. Cada tarjeta trae:

```
┌──────────────────────────────────────┐
│ ACEITE VEGETAL X 20 LT               │  ← nombre
│ 1002478 · Liter · ZOOLOGICO          │  ← código · unidad · bodega
│ ┌──────────┬──────────┬──────────┐   │
│ │  FÍSICA  │ SISTEMA  │DIFERENCIA│   │
│ │   118    │   124    │   −6     │   │  ← rojo si <0, azul si >0
│ └──────────┴──────────┴──────────┘   │
│ [AUDITABLE] No cuadra con el sistema │  ← estado de validación
│ Causa: MERMA   Ajuste: —             │
└──────────────────────────────────────┘
```

- **Un dato que falta se pinta `—`, nunca `0`** (`detalle/page.tsx:394-399`, servicio `0016:81-83`). El cero afirma «cuadra», que es otra cosa y a veces mentira. Cuando falta una de las dos cifras la tarjeta lo dice con palabras (`detalle/page.tsx:294-298`).
- **El signo `+` es explícito.** «12» y «+12» no se leen igual.
- **El fantasma marca el borde entero** en morado (`detalle/page.tsx:250-254`): es un artículo que el ERP no conoce, y eso cambia cómo se lee todo lo demás de la tarjeta. Su casilla «Sistema» dice «no existe en el ERP», no queda vacía: no es un dato perdido.
- **Seis filtros de estado** en chips desplazables: Todo · Con diferencia · Faltantes · Sobrantes · Sin catálogo · Nadie lo contó (`detalle/page.tsx:53-60`).
- **La búsqueda espera 300 ms.** Sin retardo, cada tecla es un `LIKE` sobre el histórico: escribir «aceite» son seis consultas de las que cinco ya no le importan a nadie cuando responden (`detalle/page.tsx:91-104`).

**Vocabulario en pantalla.** `clasificacion` se traduce a Conciliado/Auditable y `motivo` a castellano (`detalle/page.tsx:364-391`). El **código de razón se muestra crudo** a propósito: el catálogo lo define el negocio y traducirlo aquí sería ponerle palabras que nadie ha aprobado.

---

### Bloque 3 · Análisis temporal

**Qué pidió el cliente.** Filtrar por bodega o consolidado; filtrar y comparar por meses; ver la cantidad de ítems con diferencias de cada bodega en los últimos 12 meses; y analizar el comportamiento de un producto específico a lo largo del tiempo.

#### 3a · Doce meses, bodega por bodega

**Endpoint.** `GET /metricas/historia?meses=12&bodega=` (`metricas.service.ts:299-360`).

```sql
SELECT to_char(h.periodo, 'YYYY-MM') AS periodo, b.id AS bodega_id, b.nombre AS bodega,
       count(*) FILTER (WHERE h.rondas_afirmando >= 1 AND h.fantasma_id IS NULL)::int AS contadas,
       count(*) FILTER (WHERE h.diferencia <> 0 OR h.motivo = 'discrepancia')::int    AS con_diferencia,
       count(*) FILTER (WHERE h.diferencia < 0)::int                                  AS faltantes,
       count(*) FILTER (WHERE h.diferencia > 0)::int                                  AS sobrantes,
       sum(h.valor_ajuste)                                                            AS valor_ajuste
FROM consolidado_historico h
JOIN bodega b          ON b.id = h.bodega_id
JOIN usuario_bodega ub ON ub.bodega_id = b.id AND ub.usuario_id = $1
WHERE h.periodo >= date_trunc('month', now() AT TIME ZONE 'America/Bogota')::date
                   - make_interval(months => $2 - 1)
  [AND h.bodega_id = $3]
GROUP BY 1, 2, 3
ORDER BY 1, 3
```

**El eje temporal se genera completo aunque no haya datos** (`service:323-329`):

```sql
SELECT array_agg(to_char(m, 'YYYY-MM') ORDER BY m) AS meses
FROM generate_series(
  date_trunc('month', now() AT TIME ZONE 'America/Bogota')::date - make_interval(months => $1 - 1),
  date_trunc('month', now() AT TIME ZONE 'America/Bogota')::date,
  '1 month') m
```

Un hueco en el eje se leería como «no pasó nada»; lo que pasó es que no se inventarió. Son cosas distintas y la gerencia pregunta por la segunda. Los meses sin cierre llegan con todos sus campos en `null` (`service:347`), no en cero.

`precision` viaja junto al conteo (`service:354`) porque es la pregunta que de verdad importa: no «cuántas diferencias hubo» sino «en qué bodegas están mejorando».

**Qué gráfico se eligió: una miniatura por bodega, todas a la misma escala** (`graficos.tsx:262-342`). El razonamiento completo está en §4.

#### 3b · Un producto a lo largo del tiempo

**Endpoint.** `GET /metricas/articulo?codigo=` o `?nombre=` (`metricas.service.ts:370-399`).

```sql
SELECT to_char(h.periodo, 'YYYY-MM') AS periodo, b.nombre AS bodega,
       h.nombre, h.unidad, h.cantidad_final, h.saldo_sistema, h.diferencia, h.valor_ajuste
FROM consolidado_historico h
JOIN bodega b          ON b.id = h.bodega_id
JOIN usuario_bodega ub ON ub.bodega_id = b.id AND ub.usuario_id = $1
WHERE h.codigo = $2            -- o: lower(h.nombre) = lower($2)
ORDER BY h.periodo, b.nombre
```

**Se busca por código y no por identificador de artículo a propósito.** El mismo producto es una fila distinta en cada bodega —así viene el archivo del cliente— y la pregunta «cómo se ha comportado el ACEITE» es sobre el producto, no sobre la fila de una bodega. Hay índice para eso: `historico_por_codigo ON consolidado_historico (codigo, periodo) WHERE codigo IS NOT NULL` (`0016:108`).

**Qué se eligió: una línea por bodega, cada una con su tabla debajo** (`app/admin/historia/page.tsx:400-487`). La línea enseña la *forma* de la diferencia; la tabla enseña las tres cantidades con las que se calculó (física, sistema, diferencia) y es lo único que lee un lector de pantalla. El color de la línea lo fija el signo de la última diferencia conocida; sin dato conocido no se pinta ni de rojo ni de azul, porque no se sabe.

#### Filtros

`GET /metricas/periodos` (`service:108-137`) alimenta los dos selectores. **Incluye siempre el mes en curso aunque nadie haya cerrado nada** (`service:127-129`): es el que la gerencia va a querer mirar, y una lista que empieza en el mes pasado parece un sistema apagado. Cada opción dice si el mes está en curso o cuántas bodegas cerró.

Los filtros **viven en la URL, no en el estado de React** (`marco.tsx:12-20`). La gerencia comparte estas pantallas por chat («mira lo de julio en el Zoológico»), y un filtro guardado en memoria produce un enlace que le abre otra cosa a quien lo recibe.

#### Por qué el periodo se calcula en hora de Colombia

Un cierre del 31 de enero a las 20:00 en Bogotá es el 1 de febrero a las 01:00 UTC. Truncando en UTC, ese inventario se archivaría en febrero y enero quedaría sin cierre — justo en los cierres de fin de mes, que son todos. La conversión `AT TIME ZONE 'America/Bogota'` aparece en la migración (`0016:36-38`), en el cierre (`integracion.service.ts:136-137`), en cada consulta del servicio (`service:117, 170, 314, 326`), en el controlador (`metricas.controller.ts:113-116`) y en las tres pantallas que calculan el mes por defecto.

---

### Bloque extra · Auto-pulido

No estaba en el encargo. Responde a otra pregunta: **¿está mejorando la máquina?**

**Endpoint.** `GET /metricas/autopulido?periodo=` (`autopulido.service.ts:46-101`). Lee `critica_ronda` —que se escribe al cerrar cada ronda— y `propuesta_mejora`.

Tres índices: qué porcentaje de dictados entendió la gramática a la primera, cuántos obligaron a preguntar «¿cuál de estos?» y cuántos hubo que corregir.

**Evalúa a la máquina, nunca a la persona.** Aquí no entra un nombre de operario ni un ranking de personas. Un informe que califica a quien cuenta se acaba usando contra ella, y una herramienta que se usa contra quien la opera se abandona — y con ella se pierde el inventario entero. El aviso no está en un comentario: está arriba del todo en la pantalla (`app/admin/autopulido/page.tsx:176-192`).

**El ejemplo va etiquetado.** Mientras no haya rondas con crítica, el servidor devuelve una curva de ejemplo con `simulado: true` en la misma respuesta que los números (`autopulido.service.ts:143-165`). Está en el servidor y no en el frontend a propósito: si el día que lleguen los datos reales alguien se olvida de quitar el relleno, la bandera viaja pegada al dato y la pantalla no puede pintarlo sin decirlo. Un gráfico de tendencia inventado y sin etiqueta es una mentira con ejes.

Las **propuestas sí son reales siempre**, incluso cuando el resto del mes es un ejemplo, y no se filtran por mes: una propuesta viva en enero sigue viva en marzo, y esconderla al cambiar de filtro la haría volver como si fuera nueva (`autopulido.service.ts:74-83`).

---

## 3 · Layout visual

### Es un producto móvil primero

El contenedor es `max-w-md` —448 px— centrado (`marco.tsx:47, 71, 75`). No es una versión reducida de un tablero de escritorio: es la medida de diseño, y el escritorio hereda la misma columna centrada.

La razón es dónde se abre esto. El auditor cierra el mes desde la bodega, con el teléfono que lleva encima y la señal que hay. De ahí salen decisiones que en un tablero de escritorio no se tomarían:

| Decisión | Qué haría un tablero de escritorio | Por qué aquí no |
|---|---|---|
| **Sin librería de gráficos** | Recharts / ECharts / D3 | El paquete más pequeño que sirve pesa más que todo el frontend de este producto junto. Cuatro formas SVG a mano bastan y caben en un archivo (`graficos.tsx:7-13`). |
| **Tarjetas en el detalle** | Tabla de 7 columnas ordenable | Siete columnas no caben; el scroll lateral esconde la diferencia. |
| **Miniaturas, no líneas superpuestas** | Un gráfico con 8–48 series y leyenda conmutable | Ocho líneas en 448 px son un ovillo. §4.1. |
| **Un selector de métrica global** | Legend toggles + hover multiseries | El hover no existe con el dedo. Un `<select>` nativo abre la rueda del sistema operativo. |
| **Todo toque mide 44 px** | Filas de 24 px, iconos de 16 px | `h-11` en pestañas, botones, selectores y campos. |
| **«Cargar 50 más»** | Scroll infinito o paginador numérico | El scroll infinito con conexión intermitente deja la lista a medias sin avisar (`detalle/page.tsx:218-228`). |
| **Zonas de contacto anchas en la línea** | Hover sobre el punto | El dedo no acierta un punto de 3 px: cada mes tiene un rectángulo invisible de ancho completo (`graficos.tsx:211-226`). |
| **Solo el primer y último rótulo del eje X** | Los 12 meses rotulados | Doce etiquetas en 320 px son una franja negra ilegible (`graficos.tsx:228-236`). |
| **Filtros en la URL** | Estado en memoria | Se comparte por chat y sobrevive a recargar. |

Lo que **no** cambia entre móvil y escritorio: los endpoints, las definiciones y las formas. Un tablero de escritorio reutilizaría los siete endpoints tal cual; lo único que cambiaría es la rejilla (dos o tres columnas en vez de una) y la posibilidad de volver a la tabla real en el Bloque 2.

### Marco común de las cuatro pantallas

```
┌────────────────────────────────────────┐
│  TopBar · título · subtítulo · [ADMIN] │
├────────────────────────────────────────┤
│ [▣ Resumen][▤ Detalle][📈 Hist.][✦ …] │  ← 4 pestañas, scroll horizontal
├────────────────────────────────────────┤
│  Filtros (varían por pantalla)         │
├────────────────────────────────────────┤
│                                        │
│  contenido                             │
│                                        │
└────────────────────────────────────────┘
```

### Pantalla 1 · Resumen — `/admin`

```
┌────────────────────────────────────────┐
│ Mes: [ jul 2026 · en curso        ▾ ]  │
├────────────────────────────────────────┤
│ ┌─────────────────┬──────────────────┐ │
│ │ 📦 REFERENCIAS  │ 🎯 PRECISIÓN     │ │
│ │      1.421      │      93,4 %      │ │  ← global
│ │  en 8 bodegas   │ contadas que     │ │
│ │                 │ cuadraron        │ │
│ └─────────────────┴──────────────────┘ │
│ ⓘ Toda cantidad son REFERENCIAS, no    │
│   unidades: 300 panes faltantes son    │
│   UNA referencia con faltante, no 300. │
├────────────────────────────────────────┤
│ 💰 AJUSTE CONTABLE DEL MES             │
│    Sin costear                         │  ← §6.1
│    El maestro de artículos no trae     │
│    precios: ninguna de las N refs con  │
│    diferencia tiene costo cargado.     │
│    ▓▓▓▓▓▓▓░░░░░░░░  0 de N con costo   │
├────────────────────────────────────────┤
│ EN QUÉ TERMINÓ CADA REFERENCIA         │
│  Cuadraron sin novedad   ▓▓▓▓▓▓▓▓ 87 % │
│  Aclaradas por Auditor   ▓▓░░░░░░  6 % │
│  Con faltante · merma    ▓░░░░░░░  4 % │
│  Con sobrante            ▓░░░░░░░  2 % │
│  Fantasmas               ░░░░░░░░  1 % │
│  Sin cobertura           ░░░░░░░░  0 % │
│  ⚠ N refs siguen sin causa registrada  │
├────────────────────────────────────────┤
│ COMPARATIVO POR BODEGA                 │
│ [ Más diferencias ][ Peor precisión ]  │
│ ■cuadró ■aclarada ■faltante ■sobrante  │
│                                        │
│ ZOOLOGICO                    57 · 71 % │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▒▒▒███░░░                  │
│ STOCK ALMACEN AYB           272 · 88 % │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒██            │
│ …                                      │
├────────────────────────────────────────┤
│ ┌────────────────────────────────────┐ │
│ │ ZOOLOGICO       [EN CURSO·SIN AVAL]│ │
│ │  57        41         16           │ │
│ │ CONTADAS  SIN DIF.  CON DIF.       │ │
│ │ ─────────────────────────────────  │ │
│ │ AJUSTE CONTABLE       Sin costear  │ │
│ │ Precisión 71,9 % · 9 con faltante  │ │
│ │ · 7 con sobrante · 2 fantasmas     │ │
│ └────────────────────────────────────┘ │
│ … una tarjeta por bodega               │
├────────────────────────────────────────┤
│ CON QUÉ CAUSA SE CERRÓ CADA DIFERENCIA │
│  Merma natural       ▓▓▓▓▓▓░░░  34     │
│  Error en el conteo  ▓▓▓░░░░░░  18     │
│  Traslado sin regis. ▓░░░░░░░░   6     │
└────────────────────────────────────────┘
```

> Las cifras del dibujo son ilustrativas salvo `1.421`, que es el número real de filas de artículo de las ocho hojas del cliente. El tablero no muestra cifras de ejemplo: cuando no hay dato, muestra su ausencia.

El gráfico de causas usa **un solo color** (`app/admin/page.tsx:374-377`): las causas no son faltante ni sobrante, y darles la paleta de los hallazgos insinuaría una polaridad que no tienen. El orden —lo trae el servidor, `ORDER BY referencias DESC`— ya jerarquiza.

### Pantalla 2 · Detalle — `/admin/detalle`

```
┌────────────────────────────────────────┐
│ Mes: [ jul 2026 ▾ ]  Bodega: [Todas ▾] │
│ [Todo][Con dif.][Faltantes][Sobrantes]→│  ← chips, scroll horizontal
│ 🔍 Buscar artículo (nombre o código)   │
├────────────────────────────────────────┤
│ 50 de 1.421 artículos                  │
│                                        │
│ ┌────────────────────────────────────┐ │
│ │ ACEITE VEGETAL X 20 LT             │ │
│ │ 1002478 · Liter · ZOOLOGICO        │ │
│ │ ┌────────┬────────┬──────────────┐ │ │
│ │ │ FÍSICA │SISTEMA │  DIFERENCIA  │ │ │
│ │ │  118   │  124   │      −6      │ │ │
│ │ └────────┴────────┴──────────────┘ │ │
│ │ [AUDITABLE] No cuadra con el       │ │
│ │ sistema · Causa: MERMA             │ │
│ └────────────────────────────────────┘ │
│ ┌────────────────────────────────────┐ │
│ │ CANECA PLASTICA          [👻 SIN  ]│ │  ← borde morado entero
│ │ Sin código · Unidad · ZOOLOGICO    │ │
│ │ ┌────────┬────────┬──────────────┐ │ │
│ │ │   4    │   —    │      —       │ │ │
│ │ │        │no exis-│              │ │ │
│ │ │        │te ERP  │              │ │ │
│ │ └────────┴────────┴──────────────┘ │ │
│ └────────────────────────────────────┘ │
│                                        │
│ [        Cargar 50 más        ]        │
└────────────────────────────────────────┘
```

### Pantalla 3 · Histórico — `/admin/historia`

```
┌────────────────────────────────────────┐
│ Qué se mide: [Referencias con dif.  ▾] │  ← 4 métricas, una a la vez
│ Referencias cuyo conteo no cuadró.     │
├────────────────────────────────────────┤
│ COMPARATIVA ENTRE BODEGAS              │
│ Una bodega por recuadro, todas con la  │
│ misma escala vertical. Toca una.       │
│ ┌──────────────┐┌──────────────┐       │
│ │ZOOLOGICO     ││STOCK ALM AYB │       │
│ │      16      ││      31      │       │
│ │  ╱╲    ╱─╲   ││ ╲__      ╱   │       │  ← chispas, misma escala
│ │ ╱  ╲__╱      ││    ╲____╱    │       │
│ │ago25 — jul26 ││ago25 — jul26 │       │
│ └──────────────┘└──────────────┘       │
│ ┌──────────────┐┌──────────────┐       │
│ │KIOSCO TAQUILL││FUENTES AYB   │       │
│ │      —       ││      12      │       │  ← "—" = sin ningún cierre
│ │              ││   ─╲   ╱─    │       │
│ └──────────────┘└──────────────┘       │
│ … 8 hoy, 48 en producción              │
│ ┌────────────────────────────────────┐ │
│ │ ■ Referencias con diferencia       │ │
│ │ La línea se corta en los meses en  │ │
│ │ que la bodega no se inventarió. Un │ │
│ │ hueco no es un cero.               │ │
│ └────────────────────────────────────┘ │
├────────────────────────────────────────┤
│ ZOOLOGICO                              │  ← al tocar una miniatura
│ Referencias con diferencia             │
│ ┌────────────────────────────────────┐ │
│ │      ╱╲          ╱────╲            │ │
│ │  ───╱  ╲───     ╱      ╲           │ │  ← el hueco NO se une
│ │                                    │ │
│ │ ago 2025                  jul 2026 │ │
│ └────────────────────────────────────┘ │
│ ┌────────┬────────┬─────────────────┐  │
│ │ ÚLTIMO │PROMEDIO│ SIN INVENTARIAR │  │
│ │   16   │  19,4  │   3 de 12 meses │  │
│ └────────┴────────┴─────────────────┘  │
├────────────────────────────────────────┤
│ UN PRODUCTO EN EL TIEMPO               │
│ [ Por código ][ Por nombre ]           │
│ 🔍 Código del producto: [ 1002478 ]    │
│ [           Buscar            ]        │
│                                        │
│ ACEITE VEGETAL X 20 LT                 │
│ Liter · 2 bodegas · 4 meses cerrados   │
│ ┌────────────────────────────────────┐ │
│ │ ZOOLOGICO                          │ │
│ │   ╲                                │ │
│ │    ╲___╱╲                          │ │
│ │ ■ Diferencia (físico − sistema)    │ │
│ │ ┌──────┬──────┬───────┬─────────┐  │ │
│ │ │ MES  │FÍSICO│SISTEMA│ DIFEREN.│  │ │
│ │ │abr 26│  118 │  124  │   −6    │  │ │
│ │ │may 26│  —  sin inventariar  — │  │ │
│ │ │jun 26│  130 │  130  │    0    │  │ │
│ │ └──────┴──────┴───────┴─────────┘  │ │
│ └────────────────────────────────────┘ │
└────────────────────────────────────────┘
```

### Pantalla 4 · Auto-pulido — `/admin/autopulido`

```
┌────────────────────────────────────────┐
│ Mes: [ jul 2026 ▾ ]                    │
├────────────────────────────────────────┤
│ 🛡 ESTO EVALÚA A LA MÁQUINA, NUNCA A   │
│    LA PERSONA                          │
│ No hay nombres de operarios, ni ranking│
│ de personas, ni «quién se equivocó más»│
├────────────────────────────────────────┤
│ [DATOS DE EJEMPLO]                     │  ← solo si simulado:true
│ Este mes no tiene suficientes rondas   │
│ con crítica; lo de abajo es un ejemplo │
│ que enseña la forma del informe.       │
├────────────────────────────────────────┤
│ CÓMO LE FUE A LA MÁQUINA [DATOS DE EJ.]│
│ ┌────────────────────────────────────┐ │
│ │ ✔ ENTENDIÓ A LA PRIMERA     91,4 % │ │
│ │ ? TUVO QUE PREGUNTAR         6,2 % │ │
│ │ ✎ HUBO QUE CORREGIR          3,1 % │ │
│ └────────────────────────────────────┘ │
├────────────────────────────────────────┤
│ CÓMO VA CAMBIANDO, MES A MES           │
│ Un gráfico por índice: los tres se     │
│ miden en % pero no significan lo mismo.│
│ ┌──────────────┐ ■ Entendió a la 1ª    │
│ │      ______╱ │                       │
│ └──────────────┘                       │
│ ┌──────────────┐ ■ Tuvo que preguntar  │
│ │ ╲___         │                       │
│ └──────────────┘                       │
│ ┌──────────────┐ ■ Hubo que corregir   │
│ │ ╲____        │                       │
│ └──────────────┘                       │
├────────────────────────────────────────┤
│ DÓNDE SE ATASCA                        │
│ ┌────────────────────────────────────┐ │
│ │ La gramática no reconoce «bulto»   │ │
│ │ ZOOLOGICO       ▓▓▓▓▓▓▓░░░  34     │ │
│ └────────────────────────────────────┘ │
├────────────────────────────────────────┤
│ QUÉ PROPONE CAMBIAR   ← SIEMPRE REALES │
│ ┌────────────────────────────────────┐ │
│ │ ALIAS  [PROPUESTA]                 │ │
│ │ Añadir «bulto» como empaque        │ │
│ │ Evidencia: …                       │ │
│ │ Detectada 34 veces  🔧 Un clic     │ │
│ └────────────────────────────────────┘ │
└────────────────────────────────────────┘
```

---

## 4 · Gráficos para las comparativas mensuales

### 4.1 · Miniaturas (small multiples), no ocho líneas superpuestas

**Recomendación:** para «comparar las 8 (o 48) bodegas a lo largo de 12 meses», una rejilla de miniaturas, **todas dibujadas con la misma escala vertical** (`graficos.tsx:262-305`), con la línea grande reservada a la bodega que se toque.

Por qué:

1. **Ocho líneas en 448 px son un ovillo.** Con 12 puntos cada una y cruces constantes, seguir *una* exige una leyenda, ocho colores distinguibles y un hover que en un móvil no existe. Con 48 bodegas ni siquiera hay ocho colores distinguibles: hay cuatro, y el resto se repiten.
2. **El ojo compara formas mejor que trazos encimados.** Ocho rectángulos pequeños se leen en barrido; ocho líneas cruzadas obligan a rastrear cada una desde su extremo.
3. **La escala común es lo único que hace que funcione** (`graficos.tsx:273-274`: `Math.max(1, ...todos)` sobre *todas* las series). Si cada miniatura se escalara a su propio máximo, todas se verían igual de movidas y comparar sería imposible — que es justo lo que pidió el cliente poder hacer. Es el error clásico de los paneles de sparklines.
4. **Cada miniatura lleva su cifra del último cierre en grande** (`graficos.tsx:279, 292-294`). La forma da la tendencia; el número da la magnitud. Sin el número, dos bodegas con la misma silueta y órdenes de magnitud distintos se ven idénticas.

Consecuencia deliberada: el componente `Linea` **no admite varias series** (`graficos.tsx:116-122`). No es una limitación pendiente de resolver; es la regla escrita en código para que nadie la deshaga sin darse cuenta.

### 4.2 · Nunca un gráfico con dos ejes verticales

**Regla:** dos magnitudes distintas son dos gráficos (`graficos.tsx:17-19`).

Un eje doble deja que la elección de escala decida la conclusión. Con «referencias con diferencia» a la izquierda y «valor del ajuste» a la derecha, mover un cero en cualquiera de los dos ejes convierte «el problema se está encareciendo» en «el problema se está conteniendo», sin tocar un solo dato. No hay una escala correcta que elegir: no existe.

Cómo se cumple en el tablero:

- **En el histórico**, un único selector cambia la métrica de *todos* los gráficos a la vez (`historia/page.tsx:50-56`): se ve una medida cada vez, en el mismo eje para todas las bodegas. Cuatro medidas superpuestas serían más compactas y serían mentira.
- **En el auto-pulido**, los tres índices se miden en porcentaje y aun así van en tres gráficos separados (`autopulido/page.tsx:119-140`): comparten unidad pero no significado, y apilarlos dejaría que la escala decidiera la conclusión.

### 4.3 · Un mes sin inventariar corta la línea; no baja a cero

**Regla:** un hueco no es un cero (`graficos.tsx:19-21`).

Un cero en «referencias con diferencia» afirma dos cosas: que se contó, y que no había diferencias. Si la bodega no se inventarió, ninguna de las dos es cierta. Pintarlo en cero produce exactamente la lectura contraria a la verdad — una caída a cero se lee como el mejor mes de la serie, y llevaría a felicitar a la bodega que no contó.

Cómo se cumple, en las tres capas:

| Capa | Qué hace | Dónde |
|---|---|---|
| SQL | Genera los 12 meses del eje con `generate_series`, existan o no cierres | `service:323-329` |
| Servicio | Devuelve `null` en todos los campos del mes sin cierre, no `0` | `service:347` |
| Gráfico | Parte la serie en segmentos: cada tramo continuo es su propio `polyline` | `graficos.tsx:157-165, 185-195` |
| Gráfico | El punto del hueco no se dibuja; la zona de contacto sí existe y anuncia «sin inventariar» | `graficos.tsx:197-226` |
| Tabla | La fila dice «sin inventariar» ocupando las tres columnas | `historia/page.tsx:457-461` |

Unir los dos extremos de un hueco con una recta insinuaría una evolución que nadie midió. Por eso se dibujan *n* polilíneas y no una.

### 4.4 · La paleta se validó contra daltonismo, y cambió por eso

La paleta del tablero pasó por un comprobador de daltonismo —banda de claridad, piso de croma, separación ΔE en protanopía, deuteranopía y tritanopía, y contraste contra el fondo—. La primera versión tenía **seis colores y falló dos chequeos** (`frontend/app/globals.css:101-121`):

| Problema | Medida | Qué se hizo |
|---|---|---|
| Verde y rojo juntos | ΔE 5,8 en deuteranopía — indistinguibles para ~8 % de los hombres | **«Faltante» y «sobrante» dejaron de ser rojo y verde: son rojo y azul** |
| El turquesa se leía como gris | Croma insuficiente | Se eliminó; se bajó de seis colores a cuatro |

La paleta final:

| Token | Valor | Significa |
|---|---|---|
| `--serie-conciliado` | `#1f8a4c` | Cuadró |
| `--serie-sobrante` | `#0067b1` | Hay de más (azul Colsubsidio) |
| `--serie-faltante` | `#b1341f` | Hay de menos — la merma |
| `--serie-fantasma` | `#7a4fb5` | Estaba en la bodega y no en el ERP |
| `--serie-neutro` | `#9aa1ad` | Ausencia de hallazgo: aclarada, sin cobertura |

**La polaridad de un inventario no puede depender del par de colores que más gente confunde.** Faltante y sobrante son las dos categorías que un gerente tiene que separar de un vistazo; ponerlas en rojo/verde las hace idénticas para una de cada doce personas que abre el tablero.

El gris neutro también es una decisión: «aclarada» y «sin cobertura» no son una categoría más, son la ausencia de hallazgo. Un color propio las haría competir por la atención con las que sí piden una decisión.

**Reglas que acompañan a la paleta:**

- **El color nunca va solo** (`graficos.tsx:22-24`). Cada serie lleva rótulo o leyenda: hay quien no distingue rojo de azul y hay quien lo imprime en blanco y negro.
- **Todo gráfico tiene su equivalente en texto**: `<title>` con la serie completa en el SVG (`graficos.tsx:179-181`), `aria-label` por marca, y tabla real donde la forma lo permite.
- **Un sobrante no se pinta de verde.** Suma al balance pero sigue siendo un fallo de control; pintarlo como un acierto lo premiaría (`app/admin/page.tsx:257-264`).
- **Las cifras del histórico van sin color** (`historia/page.tsx:239-242`): «alto» es malo en faltantes y bueno en precisión, así que teñirlas todas con la misma regla mentiría en la mitad de los casos.
- **No se colorea el acierto del auto-pulido** (`autopulido/page.tsx:367-370`): exigiría fijar qué umbral se considera «bien», y ese umbral no lo ha puesto nadie todavía. Un color inventado se lee como una meta acordada.

---

## 5 · Definiciones exactas de cada KPI

> **Toda cantidad de este tablero cuenta REFERENCIAS (SKU), no unidades físicas.** 300 panes faltantes son **una** referencia con faltante, no 300. Sumar unidades daría un número enorme y sin significado, porque mezclaría kilos con litros y con unidades sueltas — el archivo del cliente trae las cuatro (`Kilogram`, `Liter`, `Unidad`, `Portion`).

Todas las condiciones salen de `AGREGADOS()` en `metricas.service.ts:452-476`, sobre el alias `x` (que es `consolidado_historico` o la proyección viva, según la fuente).

| KPI | Qué cuenta | Qué NO cuenta | Condición SQL |
|---|---|---|---|
| **contadas** | Referencias del catálogo que alguna ronda afirmó haber contado | Fantasmas (no son del catálogo); referencias que nadie contó | `rondas_afirmando >= 1 AND fantasma_id IS NULL` |
| **sinDiferencia** | Contadas que coincidieron con el sistema y nunca levantaron bandera | Las que cuadran hoy pero fueron marcadas como discrepancia (esas son *aclaradas*) | `rondas_afirmando >= 1 AND fantasma_id IS NULL AND diferencia = 0 AND motivo IS DISTINCT FROM 'discrepancia'` |
| **conDiferencia** | Referencias cuyo conteo **no cuadró con el ERP en su momento** — la «diferencia inicial» del encargo | Fantasmas | `fantasma_id IS NULL AND (diferencia <> 0 OR motivo = 'discrepancia')` |
| **aclaradas** | Tenían diferencia y tras el Auditor ya no la tienen: error de conteo, de unidad o de parametrización | Las que siguen sin cuadrar; las que no tienen causa registrada | `fantasma_id IS NULL AND motivo = 'discrepancia' AND diferencia = 0 AND codigo_razon_id IS NOT NULL` |
| **faltantes** (merma) | Tras el Auditor sigue habiendo **menos** de lo que decía el sistema | Diferencias no calculables (falta una de las dos cifras → `NULL`) | `diferencia < 0` |
| **sobrantes** | Tras el Auditor sigue habiendo **más** | Ídem | `diferencia > 0` |
| **fantasmas** | Estaban físicamente en la bodega y no existen en el ERP | Cualquier cosa con `articulo_id` | `fantasma_id IS NOT NULL` |
| **sinCobertura** | Referencias del catálogo que **nadie contó** | Las contadas, aunque cuadren | `motivo = 'sin_cobertura'` |
| **pendientes** | Con diferencia y **sin causa registrada**. En un cierre válido es 0 | — | `(diferencia <> 0 OR motivo = 'discrepancia') AND codigo_razon_id IS NULL` |
| **valorAjuste** | Suma de `diferencia × costo_unitario`. `NULL` si ninguna referencia tiene costo | — | `sum(valor_ajuste)` |
| **valorFaltantes** | El ajuste **en contra** (negativo) | — | `sum(valor_ajuste) FILTER (WHERE valor_ajuste < 0)` |
| **valorSobrantes** | El ajuste **a favor** (positivo) | — | `sum(valor_ajuste) FILTER (WHERE valor_ajuste > 0)` |
| **conCosto** | Referencias con diferencia que **sí** tienen costo cargado | — | `diferencia <> 0 AND costo_unitario IS NOT NULL` |
| **sinCosto** | Referencias con diferencia **sin** costo cargado | — | `diferencia <> 0 AND costo_unitario IS NULL` |
| **precision** | `(contadas − conDiferencia) / contadas`. `null` si `contadas = 0` | — | Calculado en TypeScript, `service:498` y `:530` |

### Correspondencia con el encargo

| El encargo pidió | KPI |
|---|---|
| Cantidad de ítems contados | `contadas` |
| Cantidad de ítems sin diferencias | `sinDiferencia` |
| Cantidad de ítems con diferencias | `conDiferencia` |
| Total de referencias que arrojaron diferencias iniciales | `conDiferencia` |
| Diferencias aclaradas/justificadas por el auditor | `aclaradas` |
| Referencias con FALTANTES reales (merma) | `faltantes` |
| Referencias con SOBRANTES reales | `sobrantes` |
| Referencias «fantasma» | `fantasmas` |
| Valor del ajuste contable a favor o en contra | `valorAjuste` / `valorSobrantes` / `valorFaltantes` — §6.1 |
| *(no pedido, el sistema lo necesita)* | `sinCobertura`, `pendientes`, `conCosto`, `sinCosto` |

### Cómo se recupera la «diferencia inicial» después del cierre

Es la parte no obvia. Cuando el Auditor aclara una referencia, la diferencia final pasa a 0 pero el registro **conserva `motivo = 'discrepancia'`**. Por eso `conDiferencia` es `diferencia <> 0 OR motivo = 'discrepancia'`: sin ese `OR`, las aclaradas desaparecerían del conteo y el informe diría que hubo menos diferencias de las que hubo. La cifra que pidió el cliente es la de *antes* del Auditor, y el `OR` es lo que la hace recuperable meses después.

### Qué particiona qué (importa para no apilar mal)

- `aclaradas`, `faltantes` y `sobrantes` **sí son disjuntas entre sí**: parten `conDiferencia` por el signo de la diferencia final (0 / negativa / positiva).
- Lo que falta para que la suma cuadre con `conDiferencia` son las referencias **sin diferencia calculable** —falta uno de los dos números—, no las pendientes.
- ⚠️ **`pendientes` NO pertenece a esa partición.** Es una marca transversal («con diferencia y sin causa») que se solapa con faltantes y sobrantes. Sirve para avisar, no para repartir. Quien apile los cinco tramos en una barra obtiene un total mayor que el real — por eso el quinto tramo de la barra del Resumen se calcula restando y no leyendo `pendientes` (`app/admin/page.tsx:411-432`).

### Convención de signo

`diferencia = cantidad_final − saldo_sistema`.

| Signo | Significa | Cómo se llama en el ajuste | Color |
|---|---|---|---|
| Negativa | Hay menos de lo que decía el sistema | **En contra** | Rojo `#b1341f` |
| Positiva | Hay más | **A favor** | Azul `#0067b1` |
| Cero | Cuadra | Sin impacto | Color de texto normal |
| `NULL` | **No se puede saber**: falta una de las dos cifras | — | `—` |

El `NULL` es deliberado y está en la migración (`0016:81-83`): «un `NULL` dice *no se puede saber*; un `0` diría *cuadra*, que es una afirmación distinta y a veces falsa».

---

## 6 · Lo que falta

### 6.1 · No hay costos

**El maestro que entregó el cliente no trae precios.** `apps/api/datos/bodegas-y-stock.xlsx`, ocho hojas de stock con estas columnas:

| Columna | Qué es |
|---|---|
| `CANTIDAD` | Un consecutivo de fila (1, 2, 3…). **No es una cantidad de nada** |
| `Nr.Artículo` | Código del artículo |
| `Artículo` | Nombre |
| `Unidad` | `Kilogram`, `Liter`, `Unidad`, `Portion` |
| `SD` | Saldo del sistema |

No hay columna de precio, de costo, de valor ni de moneda. Ni en las hojas de stock ni en la hoja `BODEGAS DISPONIBLES` (que solo trae `CANTIDAD` y `BODEGAS`).

**Qué se hizo con eso.** La tabla `costo_articulo` existe con su forma completa y **nace vacía** (`0016_periodos.up.sql:110-128`):

```sql
CREATE TABLE costo_articulo (
  bodega_id      uuid NOT NULL REFERENCES bodega(id),
  articulo_id    uuid NOT NULL REFERENCES articulo(id),
  costo_unitario numeric(14,2) NOT NULL CHECK (costo_unitario >= 0),
  moneda         text NOT NULL DEFAULT 'COP',
  fuente         text NOT NULL DEFAULT 'erp',   -- de dónde salió, para saber a quién reclamarle
  vigente_desde  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bodega_id, articulo_id)
);
```

Las semillas no la tocan (`apps/api/scripts/semillas.ts` no la menciona): rellenarla con precios plausibles sería inventar datos de negocio.

**Consecuencia en el tablero.** Con la tabla vacía, `sum(valor_ajuste)` devuelve `NULL` y el servicio lo propaga hasta la pantalla sin convertirlo en cero (`service:534-537`: `if (a === null && b === null) return null`). Entonces:

- El bloque de ajuste **no muestra `$0`, muestra «Sin costear»** y explica por qué (`app/admin/page.tsx:212-236`). Un `$0` diría «el mes cerró sin impacto contable», que es exactamente lo contrario de la verdad: no se sabe cuánto fue.
- En su lugar se muestra **la cobertura**: cuántas de las referencias con diferencia tienen costo cargado y cuántas no (`conCosto` / `sinCosto`).
- Cuando la carga sea **parcial**, el tablero muestra la cifra *y* advierte que la real es mayor: «Cubre N de M referencias con diferencia. Las restantes no tienen costo cargado, así que la cifra real es mayor que la de arriba» (`app/admin/page.tsx:234`).

**Además, el costo se congela con la foto.** `consolidado_historico` guarda `costo_unitario` y `valor_ajuste` del instante del cierre (`0016:88-93`, escritos en `integracion.service.ts:225-229`). Un informe contable que cambia de cifra cuando alguien actualiza una lista de precios no sirve para cerrar un mes.

**Qué hace falta del cliente para completarlo:**

1. **El costo unitario por artículo y bodega**, con moneda. La clave primaria es `(bodega_id, articulo_id)`: el mismo producto puede costar distinto en dos bodegas, y así viene ya organizado el archivo de stock.
2. **El método de valoración que usa Colsubsidio** —promedio ponderado, última compra, costo estándar— porque determina qué número pedirle al ERP. No se asume ninguno.
3. **La fecha de vigencia** de cada costo, para que el cierre de enero use el costo de enero. El campo `vigente_desde` ya está.
4. **La fuente**: qué sistema es el dueño del dato, para saber a quién reclamarle si un ajuste sale raro.

Formato mínimo aceptable: un CSV con `codigo_articulo; bodega; costo_unitario; moneda; vigente_desde; fuente`. Los permisos de escritura ya están otorgados (`0016:131`: `GRANT SELECT, INSERT, UPDATE ON costo_articulo TO app_role`); falta el cargador y el dato.

Mientras tanto, **el impacto del mes existe y se mide en referencias**, que es lo que sí se puede afirmar.

### 6.2 · No hay historia todavía

`consolidado_historico` se escribe en **un solo sitio del sistema**: el método privado `congelar()` (`integracion.service.ts:205-256`), llamado únicamente desde `cerrarInventario()` (`:165`), que a su vez exige el aval del Auditor (`:127`).

**El sistema aún no ha cerrado ningún mes.** Por lo tanto:

- `GET /metricas/historia` devuelve los 12 meses del eje y **cero series**.
- La pantalla lo dice con todas sus letras en vez de enseñar un gráfico vacío (`historia/page.tsx:160-164`): *«Todavía no hay ningún mes cerrado. El histórico se construye con cada cierre: cuando el Auditor avale el inventario de una bodega, ese mes queda escrito y aparecerá aquí junto al de las demás. No falta nada — falta el primer cierre.»*
- `GET /metricas/resumen` **sí funciona hoy** para el mes en curso, porque cae en la rama de proyección viva y viene marcado `fuente: 'proyeccion'`.

**Por qué no se puede rellenar hacia atrás.** No es pereza ni una tarea pendiente: es imposible sin inventar.

1. Una foto es, por definición, el estado de un instante que ya pasó. Escribirla hoy con fecha de enero no la convierte en lo que se avaló en enero.
2. La única fuente disponible para reconstruirla sería `articulo_consolidado`, que es una proyección **viva**: se recalcula entera cada vez que cierra una ronda (`0016:12-15`). Preguntarle por enero devolvería lo que se concluiría *hoy*, con los registros de hoy — y guardarlo como «enero» sería fabricar un dato de negocio.
3. La tabla es de solo-inserción por diseño: `REVOKE UPDATE, DELETE ON consolidado_historico FROM app_role` (`0016:134`). Su valor es precisamente haber sido escrita en un momento que ya pasó.

**Los doce meses se llenan con el uso: un punto por bodega y por cierre mensual.** A partir del primer cierre la gráfica empieza a tener sentido; a partir del tercero ya se puede hablar de tendencia. No hay atajo, y el que existiría —simular— es exactamente lo que este sistema se niega a hacer, con una única excepción que va etiquetada en pantalla (el auto-pulido, §2).

### 6.3 · Las 48 bodegas oficiales no están mapeadas

El archivo del cliente trae **nueve hojas**:

| Hoja | Filas | Qué es |
|---|---|---|
| `BODEGAS DISPONIBLES` | 48 | La lista oficial de bodegas: `CANTIDAD` (consecutivo) + `BODEGAS` (nombre) |
| `STOCK ALMACEN  SUMINISTROS` | 298 | Stock |
| `STOCK ALMACEN AYB ` | 272 | Stock |
| `STOCK RESTAURANTE FUENTES AYB` | 346 | Stock |
| `STOCK RESTAURANTE FUENTES SUMIN` | 135 | Stock |
| `STOCK KIOSCO TAQUILLA AYB` | 60 | Stock |
| `STOCK KIOSCO PISCIGIROS AYB` | 58 | Stock |
| `ZOOLOGICO` | 57 | Stock |
| `ZOOLOGICO SUMINISTROS` | 195 | Stock |
| | **1.421** | Total de filas de artículo |

**Los nombres no emparejan.** La lista oficial está en minúscula y con otra nomenclatura (`administracion  suministros piscilago`, `almacen general`, `autoservicios cascada `, `Tienda souvenir pisciloca suministros`); las hojas de stock usan `STOCK <ALGO> AYB`. Emparejarlos exigiría adivinar cuál corresponde a cuál, y eso es inventar un dato de negocio.

Lo que se hizo (`semillas.ts:157-167`): **se registran las 8 bodegas que sí tienen datos**, una por hoja de stock, con el nombre de la hoja como código y nombre. El emparejamiento con las 48 queda pendiente del cliente.

Detalles menores del archivo, dichos para que nadie se sorprenda: la hoja `STOCK KIOSCO PISCIGIROS AYB` trae la columna consecutivo escrita `CANTIDA` (sin la D final) y `STOCK RESTAURANTE FUENTES SUMIN` trae una columna extra sin encabezado. Ninguna de las dos afecta a la carga: el lector solo usa `Nr.Artículo`, `Artículo`, `Unidad` y `SD` (`semillas.ts:78-90`).

---

## 7 · Qué haría falta para producción con las 48 bodegas

Concreto, en orden de bloqueo.

| # | Qué | Por qué | Quién |
|---|---|---|---|
| 1 | **Tabla de equivalencia bodega ERP ↔ hoja de stock** (48 filas: código ERP, nombre oficial, sede) | Sin ella no se puede pasar de 8 a 48 sin adivinar. §6.3 | Cliente |
| 2 | **Carga de `costo_articulo`** desde el ERP + método de valoración confirmado | Desbloquea el «valor del ajuste contable», que es la mitad del encargo. §6.1 | Cliente + 1 script |
| 3 | **Catálogo definitivo de códigos de razón** | Los nueve actuales son provisionales (`semillas.ts:233-248`) y son los que rotula el gráfico de causas | Cliente |
| 4 | **Asignar bodegas al usuario de gerencia** en `usuario_bodega` | Todas las consultas filtran por ese join (§2). Un gerente nacional sin las 48 asignadas ve un consolidado parcial **y no se entera**: la respuesta es válida, solo que incompleta | Operación |
| 5 | **Ordenar y acotar las miniaturas del histórico** | Hoy llegan en orden alfabético (`service:318`, `ORDER BY periodo, bodega`). Con 8 se recorren; con 48 hay que ordenarlas por peor resultado y/o mostrar las N peores con un «ver todas» — el mismo criterio que ya tiene el comparativo del Resumen | Frontend, ~½ día |
| 6 | **Panel de «qué bodegas faltan por cerrar este mes»** | `periodos()` devuelve cuántas cerraron (`service:109-114`), no cuáles faltan. Con 48 bodegas y un cierre mensual, esa lista es la herramienta de seguimiento del cierre | Backend + frontend, ~1 día |
| 7 | **Exportar el informe mensual a CSV/Excel desde el tablero** | La exportación existente es por bodega y sobre el consolidado vivo (`integracion.controller.ts:34-68`). El histórico consolidado del mes —que es lo que va a un comité— no tiene botón de descarga | ~1 día |
| 8 | **Dar acceso al tablero al rol `auditor` en el frontend** | La API ya lo admite en las siete rutas, pero el cliente lo redirige a `/auditor` (`frontend/lib/data.ts:92-96` + `RequireRole role="admin"` en las cuatro páginas). Es una decisión de producto, no un fallo: hoy el auditor tiene su propia pantalla | Decisión + ~2 h |
| 9 | **Medir el `resumen` con volumen real** | 48 bodegas × ~1.400 referencias ≈ 67.000 filas por mes, ~800.000 al año. Los índices están (`0016:106-108`) y el agregado va por `periodo` + `bodega_id`, que es exactamente `historico_por_periodo`. Hay que medirlo, no suponerlo | Backend, ~½ día |
| 10 | **Decidir si `Liter` lleva tolerancia de merma** | Hoy solo `Kilogram` la tiene, porque el SPEC habla de «unidad de peso» (`semillas.ts:136-143`). Un líquido también se derrama y se evapora. **No se asumió**, y afecta directamente a cuántas referencias entran como faltante | Cliente |

Lo que **no** hace falta tocar para escalar a 48: el modelo de datos (la clave del cierre ya es `(bodega_id, periodo)`), las definiciones de KPI (se escriben una vez en `AGREGADOS()`), la paginación del detalle (ya es real, con tope duro) ni las formas de los gráficos (las miniaturas están pensadas para muchas series; lo que falta es ordenarlas).

---

## Anexo · Índice de archivos

| Archivo | Qué contiene |
|---|---|
| `apps/api/drizzle/0016_periodos.up.sql` | El modelo del mes: cierre por bodega+periodo, `consolidado_historico`, `costo_articulo` |
| `apps/api/src/modules/metricas/metricas.service.ts` | Las cinco consultas del tablero y la definición única de cada KPI (`AGREGADOS`, `:452`) |
| `apps/api/src/modules/metricas/metricas.controller.ts` | Los siete endpoints, sus roles y la validación de parámetros |
| `apps/api/src/modules/metricas/autopulido.service.ts` | El bloque de auto-pulido y su ejemplo etiquetado |
| `apps/api/src/modules/integracion/integracion.service.ts` | `cerrarInventario()` (`:126`) y `congelar()` (`:205`): dónde se toma la foto mensual |
| `frontend/components/admin/graficos.tsx` | Las cuatro formas SVG y las reglas que cumplen todas |
| `frontend/components/admin/marco.tsx` | Marco, pestañas, filtros, estados y el sello de «sin avalar» |
| `frontend/app/admin/page.tsx` | Pantalla 1 · Resumen comparativo |
| `frontend/app/admin/detalle/page.tsx` | Pantalla 2 · Reporte detallado |
| `frontend/app/admin/historia/page.tsx` | Pantalla 3 · Histórico y producto en el tiempo |
| `frontend/app/admin/autopulido/page.tsx` | Pantalla 4 · Auto-pulido |
| `frontend/app/globals.css` | La paleta y su validación contra daltonismo (`:101-121`) |
| `frontend/lib/metricas.ts` | Cliente HTTP y tipos. Ni una cifra se calcula aquí |
| `apps/api/scripts/semillas.ts` | Carga del archivo real del cliente; las 8 bodegas y por qué no son 48 |
| `apps/api/datos/bodegas-y-stock.xlsx` | El archivo del cliente. 9 hojas, 1.421 filas de artículo, **sin precios** |
