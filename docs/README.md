# Documentación

Todo vive junto al código, no en un sitio aparte: un documento que se mantiene en
otro repositorio deja de mantenerse. Este índice solo dice qué es cada cosa y en
qué orden leerla.

## Por dónde empezar

| Si quieres… | Lee |
|---|---|
| Entender qué hace y por qué | [SPEC.md](../SPEC.md) — el encargo original del cliente |
| Entender las reglas del juego | [constitution.md](../.specify/memory/constitution.md) — los principios que rigen cada decisión |
| Ver el detalle funcional | [spec.md](../specs/001-captura-inventarios/spec.md) — historias, requisitos y criterios |
| Levantarlo en tu máquina | [quickstart.md](../specs/001-captura-inventarios/quickstart.md) |

## El diseño

| Documento | Qué contiene |
|---|---|
| [plan.md](../specs/001-captura-inventarios/plan.md) | La arquitectura: monolito modular, dominios y sus fronteras |
| [research.md](../specs/001-captura-inventarios/research.md) | Las decisiones **D-01 … D-25**, cada una con su alternativa descartada y el porqué |
| [data-model.md](../specs/001-captura-inventarios/data-model.md) | Las tablas y —más importante— los invariantes que el motor impone |
| [contracts/events.md](../specs/001-captura-inventarios/contracts/events.md) | Los eventos que cruzan entre dominios |
| [dashboard-administrativo.md](../specs/001-captura-inventarios/dashboard-administrativo.md) | El informe de gerencia: bloques, consultas y por qué cada gráfico es el que es |

## La construcción

| Documento | Qué contiene |
|---|---|
| [tasks.md](../specs/001-captura-inventarios/tasks.md) | El desglose por rebanadas verticales |
| [entrega-frontend.md](../specs/001-captura-inventarios/entrega-frontend.md) | El contrato con quien construyó las pantallas |
| [checklists/requirements.md](../specs/001-captura-inventarios/checklists/requirements.md) | Verificación de que los requisitos están bien escritos |
| [infra/terraform/README.md](../infra/terraform/README.md) | Qué se despliega, con qué permisos y cómo se opera |

## La calidad

| Documento | Qué contiene |
|---|---|
| [barrido-qa.md](../specs/001-captura-inventarios/barrido-qa.md) | Seis auditorías independientes: lo corregido, lo pendiente por gravedad con su escenario concreto, y lo que se intentó romper y aguantó |
| [estado-de-la-documentacion.md](../specs/001-captura-inventarios/estado-de-la-documentacion.md) | Qué documento sigue vigente y cuál quedó desfasado respecto al código |

## Cómo leer un documento viejo

Buena parte de esto se escribió **antes** que el código, y eso no lo invalida: un
documento de investigación fechado sigue siendo cierto sobre el momento en que se
decidió. Lo que sí conviene comprobar contra el repositorio es cualquier cosa que
describa el **esquema actual** o **qué proveedor está encendido**, porque eso ha
cambiado.

`estado-de-la-documentacion.md` lleva esa cuenta, documento por documento.
