# Documentación

Todo lo que explica este sistema, en un solo sitio y junto al código: un
documento que se mantiene en otro repositorio deja de mantenerse.

## Si tienes cinco minutos

| Lee esto | Y sabrás |
|---|---|
| [El encargo del cliente](01-fundamentos/el-encargo-del-cliente.md) | Qué pidió Colsubsidio, con sus palabras |
| [Reglas no negociables](01-fundamentos/reglas-no-negociables.md) | Las diez o doce cosas que el sistema no puede violar, y dónde está impuesta cada una |
| [Historias de usuario](02-producto/historias-de-usuario.md) | Qué hace el producto, contado desde quien lo usa |

Si solo vas a abrir un documento, que sea el de **reglas no negociables**: es lo
que separa este sistema de uno que simplemente funciona.

---

## 01 · Fundamentos — por qué existe

| | |
|---|---|
| [el-encargo-del-cliente.md](01-fundamentos/el-encargo-del-cliente.md) | El SPEC original. Es la autoridad sobre el comportamiento del producto: ante conflicto con cualquier otro documento, manda este |
| [principios.md](01-fundamentos/principios.md) | La constitución. Nueve principios que gobiernan cada especificación, plan y decisión |
| [reglas-no-negociables.md](01-fundamentos/reglas-no-negociables.md) | Las garantías del dominio, con el sitio del código donde cada una se hace cumplir |

## 02 · Producto — qué hace

| | |
|---|---|
| [especificacion-funcional.md](02-producto/especificacion-funcional.md) | El documento central: historias, requisitos `FR-x.y`, criterios `SC-x.y` y casos borde |
| [historias-de-usuario.md](02-producto/historias-de-usuario.md) | Las historias sacadas a un documento propio, con la pantalla donde se ven funcionando |
| [verificacion-de-requisitos.md](02-producto/verificacion-de-requisitos.md) | Comprobación de que los requisitos están bien escritos, antes de construir nada |

## 03 · Arquitectura — cómo está hecho

| | |
|---|---|
| [plan-tecnico.md](03-arquitectura/plan-tecnico.md) | Monolito modular, los dominios y sus fronteras |
| [decisiones-de-diseno.md](03-arquitectura/decisiones-de-diseno.md) | **D-01 … D-25**: cada decisión con su alternativa descartada y el porqué |
| [modelo-de-datos.md](03-arquitectura/modelo-de-datos.md) | Las tablas y, sobre todo, los invariantes que el motor impone |
| [eventos.md](03-arquitectura/eventos.md) | Lo que cruza entre dominios |
| [api-http.yaml](03-arquitectura/api-http.yaml) | El contrato HTTP, en OpenAPI |

## 04 · Infraestructura

Vive junto al Terraform, que es donde la busca quien opera:
[`infra/terraform/README.md`](../infra/terraform/README.md).

## 05 · Tablero administrativo

| | |
|---|---|
| [diseno-del-tablero.md](05-tablero/diseno-del-tablero.md) | El informe de gerencia: los tres bloques, sus consultas SQL, la disposición y por qué cada gráfico es el que es |

## 06 · Calidad

| | |
|---|---|
| [barrido-de-qa.md](06-calidad/barrido-de-qa.md) | Seis auditorías independientes: lo corregido, lo pendiente ordenado por gravedad con su escenario concreto, y lo que se intentó romper y aguantó |
| [estado-de-la-documentacion.md](06-calidad/estado-de-la-documentacion.md) | Qué documento sigue siendo cierto y cuál quedó desfasado |

## 07 · Operación

| | |
|---|---|
| [puesta-en-marcha.md](07-operacion/puesta-en-marcha.md) | Levantarlo en tu máquina, paso a paso |
| [plan-de-trabajo.md](07-operacion/plan-de-trabajo.md) | El desglose por rebanadas verticales |
| [contrato-con-el-frontend.md](07-operacion/contrato-con-el-frontend.md) | Lo acordado con quien construyó las pantallas |

---

## Antes de creerte un documento

Buena parte de esto se escribió **antes** que el código, y eso no lo invalida: un
documento de investigación fechado sigue siendo cierto sobre el momento en que se
decidió. Lo que conviene comprobar contra el repositorio es cualquier cosa que
describa el **esquema actual** o **qué proveedor está encendido**, porque ambas
cosas cambiaron.

[`estado-de-la-documentacion.md`](06-calidad/estado-de-la-documentacion.md) lleva
esa cuenta documento por documento, con tres etiquetas: **al día**, **desfasado**
e **histórico**. Está ahí porque una documentación que no dice dónde miente hace
más daño que una que no existe.
