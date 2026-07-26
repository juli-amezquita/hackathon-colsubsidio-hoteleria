# Captura Inteligente de Inventarios

Conteo de inventario físico por voz para las bodegas de Colsubsidio, con conteo a
ciegas, auditoría de discrepancias y cierre mensual hacia el sistema central.

**En línea:** https://d1jhay4xdswind.cloudfront.net

| Rol | Usuario | Clave | Dónde entra |
|---|---|---|---|
| Operario | `1000000001` | `Inventario2026*` | Cuenta la bodega, hablando |
| Auditor | `1000000002` | `Inventario2026*` | Resuelve discrepancias y avala el cierre |
| Administración | `1000000003` | `Inventario2026*` | Tablero de métricas y cierre de mes |

El mismo formulario para los tres: el rol lo decide el servidor y cada quien
aterriza en su pantalla. No hay selector de rol, porque un rol que se elige no es
un permiso.

---

## El problema

Hoy el conteo se hace en papel y alguien lo transcribe después. La transcripción
es donde nacen los errores, y el error solo se descubre semanas más tarde, cuando
ya no hay forma de saber si faltaba mercancía o si alguien escribió mal un número.

El archivo real del cliente tiene **1.421 artículos** repartidos en 8 bodegas de
Piscilago, con nombres como `CAJA PARA PAPAS PAQ X100` y unidades mezcladas
—kilos, litros, unidades sueltas—. Y 79 de esos artículos vienen del ERP con
**saldo negativo**, que es precisamente la clase de anomalía que un inventario
existe para encontrar.

## Cómo funciona

**El operario cuenta a ciegas.** Habla —«arroz blanco, veinte kilos»— y el sistema
resuelve el nombre contra el catálogo, confirma en voz y por escrito, y registra.
Nunca ve lo que el sistema esperaba encontrar. Esa ceguera es la garantía: una
coincidencia con la cifra del ERP no se puede fabricar si no se conoce la cifra.

**Las alertas no dicen hacia dónde.** Si el conteo no cuadra, el operario recibe
un aviso que no revela ni la dirección ni la magnitud de la diferencia. Solo puede
sostener su conteo o volver a contar, y tiene que responder antes de cerrar.

**Ningún conteo toca el inventario de la compañía.** El libro solo acumula
afirmaciones. El saldo oficial se mueve en un único punto de todo el sistema: el
cierre mensual, con el aval del Auditor.

**El Auditor recibe el expediente, no un veredicto.** Ve lo que contó cada ronda,
lo que decía el sistema, y una síntesis que ordena la evidencia y le hace
preguntas, sin recomendarle jamás una cifra. Un modelo que sugiere «yo pondría 40»
empuja a firmar el número de la máquina, y eso es lo contrario de auditar.

**La gerencia mira el mes cerrado.** Comparativa entre bodegas, detalle por
referencia, doce meses de histórico, y el auto-pulido: qué aprendió el sistema
sobre sí mismo. Cuenta **referencias, no unidades** — 300 panes faltantes son una
referencia con faltante, no 300.

## Cómo levantarlo

```bash
docker compose up -d     # Postgres 17 + Redis
pnpm install
pnpm db:migrate          # migraciones
pnpm db:seed             # carga el archivo real del cliente
pnpm dev                 # API en :3000, pantallas en :3001
```

Detalle en [`puesta-en-marcha.md`](documentacion/07-operacion/puesta-en-marcha.md).

```bash
pnpm test        # 349 pruebas
pnpm typecheck
```

## Con qué está hecho

TypeScript estricto · Node 22 · NestJS sobre Fastify · PostgreSQL 17 con
`pg_trgm` · Redis · Next.js 16 y React 19 · SQL escrito a mano, sin ORM ·
Terraform sobre EC2 Graviton, con nginx y Docker.

Unas 29.000 líneas entre código y esquema.

**Los proveedores externos son intercambiables** y ninguno es obligatorio: el
sistema arranca entero en modo simulado, sin credenciales y sin red.

| Función | Hoy | Por qué |
|---|---|---|
| Escuchar | Gemini Live | Transcribe los nombres del catálogo con fidelidad |
| Hablar | Amazon Polly | Dice el texto exacto; la instancia firma con su rol de IAM |
| Arbitraje | Determinista | Ordena la evidencia sin modelo, y nunca sugiere una cifra |
| ERP | Simulado | El adaptador de Oracle Fusion no se ha probado contra una instancia real |

La voz **no** la sintetiza un modelo conversacional, y es deliberado: se probó, y
aun ordenándole a temperatura 0 que repitiera palabra por palabra, reescribía la
frase e improvisaba consejos para el operario. Lo que el operario oye lo escribe
el código, no un modelo.

## Documentación

Índice completo en [`documentacion/`](documentacion/README.md).

| Documento | Qué responde |
|---|---|
| [Especificación funcional](documentacion/02-producto/especificacion-funcional.md) | Qué hace el sistema, historia por historia |
| [Constitución](documentacion/01-fundamentos/principios.md) | Los principios que rigen cada decisión |
| [Plan técnico](documentacion/03-arquitectura/plan-tecnico.md) | Cómo está construido |
| [Investigación](documentacion/03-arquitectura/decisiones-de-diseno.md) | Las decisiones D-01…D-25 y por qué |
| [Modelo de datos](documentacion/03-arquitectura/modelo-de-datos.md) | Las tablas y sus invariantes |
| [Tablero administrativo](documentacion/05-tablero/diseno-del-tablero.md) | El diseño del informe de gerencia |
| [Barrido de QA](documentacion/06-calidad/barrido-de-qa.md) | Lo auditado, lo corregido y lo pendiente |
| [Infraestructura](infra/terraform/README.md) | Qué se despliega y cómo |

## Lo que falta, dicho sin adornos

- **No hay costos.** El archivo del cliente trae cantidad, unidad y código; no
  trae precio. La tabla existe y nace vacía, y el tablero declara la cobertura en
  vez de sumar ceros y llamarlo un total contable.
- **No hay histórico todavía.** Se construye con cada cierre mensual y no se puede
  rellenar hacia atrás sin inventar.
- **Las 48 bodegas oficiales del archivo no están mapeadas** contra las 8 hojas de
  stock: no hay forma de emparejarlas sin adivinar. Están las 8 con datos.
- **El adaptador de Oracle Fusion no se ha probado** contra una instancia real.
- **Quedan hallazgos abiertos** del barrido de QA, listados por gravedad y con su
  escenario concreto en [`barrido-de-qa.md`](documentacion/06-calidad/barrido-de-qa.md).
