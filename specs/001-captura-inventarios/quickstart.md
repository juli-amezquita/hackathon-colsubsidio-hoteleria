# Quickstart — Levantar y Validar

**Feature**: `001-captura-inventarios` · Guía de ejecución y validación. La implementación vive en `tasks.md`.

---

## 1. Requisitos

| | |
|---|---|
| Node.js | 22 LTS |
| pnpm | 10+ (`packageManager: pnpm@10.31.0`) |
| Docker | Para Postgres 17 y Redis 7 locales |
| Navegador | Chromium reciente (WebRTC + `speechSynthesis`) |
| Credenciales | Ninguna es obligatoria. `GEMINI_API_KEY` para la voz del agente; `OPENROUTER_API_KEY` para el árbitro y la interpretación; `DEEPGRAM_API_KEY` y las de Oracle **no se han cargado nunca** y su ruta sigue en simulado |

---

## 2. Arranque

```bash
pnpm install
cp .env.example .env            # revisar: nada de secretos reales en el repo
docker compose up -d postgres redis
pnpm db:reset                   # migra desde cero + datos semilla (Restricción 6)
pnpm dev                        # API en :3000
pnpm --filter @cci/web dev      # pantallas (Next.js), en otra terminal
```

El frontend es **Next.js**, no Vite, y se sirve desde el **mismo origen** que la API: la cookie de sesión es `SameSite=Strict` y un frontend en otro dominio no la enviaría. En producción ese reparto lo hace nginx; en desarrollo lo hace el bloque `rewrites` de `frontend/next.config.mjs`, que apunta a `API_INTERNA` (por defecto `http://127.0.0.1:3000`).

`pnpm db:reset` deja el sistema en un **estado inicial conocido y reproducible**. No son datos inventados: carga `apps/api/datos/bodegas-y-stock.xlsx`, el archivo que entregó el cliente. Cada hoja de stock es una bodega, con sus artículos, unidades, códigos y saldos esperados reales — incluidos los **saldos negativos**, que no se corrigen porque son anomalías del sistema central y el inventario existe para encontrarlas. Siembra además cuatro usuarios de prueba y las tolerancias de merma iniciales (0,2% en unidades de peso).

### Credenciales de la demostración

| Documento | Rol | A dónde entra |
|---|---|---|
| `1000000001` | Operador | `/afiliado` — conteo ciego |
| `1000000002` | Auditor | `/auditor` — casos auditables |
| `1000000003` | Administrador | `/admin` — tablero de gerencia |
| `1000000004` | Supervisor | `/admin` — el mismo tablero; su modo consulta (D-10) ya le da el estado de las bodegas |

Clave para todos: `Inventario2026*` (`SEMILLA_PASSWORD` la cambia). El mismo formulario de ingreso lleva a cada rol a su pantalla; no hay una URL distinta por rol ni selector de rol. En la interfaz el Operador se llama `afiliado` —es la palabra con la que se construyeron las pantallas—; hacia el servidor viaja `operador`, que es el rol que existe de verdad (`frontend/lib/data.ts`).

Demostración desplegada: **https://d1jhay4xdswind.cloudfront.net**

**Modo simulado**: el ERP registra los envíos en una tabla local y la ruta de Deepgram devuelve un guion fijo. Permite validar todo el flujo sin costo ni red externa. Lo que **sí** está encendido en el despliegue: la escucha con **Gemini Live** (`PROVEEDOR_AGENTE_VOZ=gemini`) y la voz con **Amazon Polly** (`PROVEEDOR_TTS=polly`, por defecto en `config.ts`). Polly no lleva credencial: la instancia firma con su propio rol de IAM. Se eligió porque la capa gratuita de Gemini da **diez síntesis al día por modelo** —un conteo real las agota en los primeros minutos— y porque un sintetizador dice exactamente el texto que recibe, mientras que un modelo conversacional elige qué decir.

---

## 3. Escenarios de validación

Cada escenario prueba una historia de punta a punta y dice qué debe observarse.

⚠️ **Los comandos de esta sección se escribieron antes que la suite.** Los scripts `test:e2e`, `test:contract`, `test:integration`, `test:perf`, `test:lighthouse`, `test:a11y` y `test:security` **nunca existieron** en `package.json`. Todo corre con un solo comando —`pnpm test`, que es `vitest`— y los ficheros están en `apps/api/test/`. Abajo se apunta a los que cubren cada escenario. Lo que **no** tiene runner automatizado y sigue siendo verificación manual: accesibilidad (E10), Lighthouse y k6 (parte de E9), y la inspección del almacenamiento del navegador (parte de E2).

### E1 · Conteo ciego en ronda propia — Historia 1

```bash
pnpm test -- slice1
```

**Verifica**: login → rol deducido → apertura de ronda → 20 artículos por voz y texto → cuadre de cierre → cierre.

**Debe observarse**: los 20 registros con autor, momento, modo de captura y bodega. Todos los artículos del catálogo en estado explícito tras el cierre. Confirmación visual **y** auditiva por registro.

**Falla la validación si**: algún artículo queda indefinido, o la interfaz confirma antes de que el registro sea durable en IndexedDB.

### E2 · El conteo es realmente ciego — SC-1.3, Principio II

```bash
pnpm test -- slice1 validacion clasificacion
```

Es la prueba innegociable del proyecto. Recorre **toda** respuesta que la API puede devolver a un rol Operador y verifica que no aparece el saldo esperado, ni la tolerancia, ni la magnitud de la diferencia, ni nada de lo que se derive. Inspecciona además el almacenamiento local del navegador tras una sesión completa.

**Si esta prueba se cae, el conteo dejó de ser ciego** y el sistema perdió su garantía principal. No se despliega con esta prueba en rojo.

### E3 · Validación de unidad y discrepancia — Historia 2

```bash
pnpm test -- slice2 validacion
```

**Verifica**: unidad equivocada → alerta con la unidad correcta. Diferencia dentro de tolerancia → sin alerta. Fuera de tolerancia, a favor y en contra → alerta. Diferencia exactamente en el límite → **dentro** de tolerancia. Confirmación pese a alerta → marca de advertencia y evidencia. Cierre bloqueado con alertas abiertas.

### E4 · Consolidación contra el saldo esperado — Historia 3

```bash
pnpm test -- slice3 clasificacion
```

**Verifica** las clasificaciones con **una sola ronda cerrada**: conteo que coincide con el saldo esperado dentro de tolerancia → *conciliado*; conteo con discrepancia → *auditable*; artículo que ninguna ronda afirmó → *auditable por sin cobertura*; artículo sin saldo esperado → *auditable*, nunca conciliado.

**Y con una segunda ronda presente**: dos rondas con cantidades distintas → *auditable* sin que el sistema elija, aunque ambas estén dentro de tolerancia; una ronda que coincide y otra que no → *auditable* (FR-3.10, regla conservadora); dos rondas que coinciden entre sí y con el saldo → *conciliado*, igual que con una sola.

**Falla la validación si**: algún artículo queda auditable por el solo hecho de que la bodega tuviera una única ronda.

**Debe observarse**: el consolidado reproduce las cantidades originales de cada ronda, sin fusiones.

### E5 · Reconteo del Auditor — Historia 4

```bash
pnpm test -- slice4
```

**Verifica**: el Auditor ve exactamente los ítems auditables y ninguno más; ve el detalle por ronda; registra reconteo por voz o texto; **no puede cerrar sin código de razón**; el inventario no cierra con auditables pendientes.

### E6 · Continuidad ante pérdida de red — Historia 6, Restricción 2

```bash
pnpm test -- slice6 idempotencia
```

Corta la red **diez veces** durante un conteo de 20 ítems.

**Debe observarse**: cero registros perdidos, cero duplicados, reanudación en el ítem siguiente al último grabado, historial de los últimos 3–5 visibles, y distinción inequívoca entre *guardado* y *validado*.

### E7 · Inmutabilidad — D2, FR-1.13

```bash
pnpm test -- inmutabilidad
```

Intenta `UPDATE` y `DELETE` directos sobre las tablas del libro con el rol de la aplicación. **Ambos deben fallar en el motor**, no en la capa de aplicación. Verifica también que una corrección añade un registro y conserva el anterior.

### E8 · Degradación de proveedores — Restricción 5

```bash
pnpm test -- degradacion proveedores
```

Con el proveedor de voz caído, el de interpretación caído y el ERP caído — **por separado y juntos** — el operario debe poder seguir contando por texto y ningún registro puede perderse.

### E9 · Rendimiento — Principio VII

```bash
pnpm test -- rendimiento
```

**Umbrales que fallan la build**: API p95 < 200 ms con 500 usuarios concurrentes simulados · ciclo de registro p95 < 1.500 ms · JS inicial ≤ 170 KB gzip · LCP < 2,5 s · TTI < 3 s.

### E10 · Accesibilidad — Principio VIII, WCAG 2.1 AA

```bash
# No hay suite automatizada de accesibilidad en el repo.
```

`axe` sobre cada ruta, sin violaciones serias ni críticas. Contraste, objetivos táctiles y navegación por teclado. **Complemento manual obligatorio**: recorrer el flujo de conteo completo con lector de pantalla y con una sola mano — eso no lo verifica una herramienta.

### E11 · Seguridad — Principio V, OWASP ASVS L2

```bash
pnpm test -- seguridad
```

**Debe observarse**: sin secretos en el bundle del cliente, CSP sin `unsafe-inline`, cookies `httpOnly`+`Secure`+`SameSite=Strict`, límite de intentos de autenticación, y **ningún log con audio, credenciales o datos personales**.

---

## 4. Comprobación de que todo pasa

```bash
pnpm verify    # build + typecheck + lint + test  (es literalmente eso, ni más ni menos)
```

Es la misma secuencia que corre CI. Si `verify` pasa en local, pasa en CI.

---

## 5. Comandos útiles

```bash
pnpm db:migrate            # aplicar migraciones pendientes
pnpm db:rollback           # revertir la última (toda migración tiene down probado)
pnpm db:reset              # estado inicial conocido (migra + siembra)
pnpm db:seed               # solo sembrar
pnpm db:verificar          # comprobar que el esquema aplicado es el esperado
pnpm --filter @cci/api reconstruir   # reconstruir las proyecciones desde el libro
```

---

## 6. Antes de dar por bueno el MVP

Tres cosas que **ninguna prueba automatizada cubre** y que deben hacerse en el mundo real:

1. **Contar una bodega de verdad**, con ruido, con guantes y con la red que realmente hay. Es donde se mide lo único que la captura libre pone en riesgo: **con qué frecuencia el operario tiene que escoger entre candidatos** porque el nombre que él usa no es el del ERP. Por encima del 10%, la solución es poblar la tabla de alias de esa bodega, no tocar el algoritmo (D-19).
2. **Medir la cobertura de la gramática** en producción. Por debajo del 85%, el costo y la latencia se van al LLM y hay que ampliar la gramática, no el presupuesto.
3. **Resolver la decisión D-07** (dónde se conecta el proveedor de voz). El plan asume la opción A; la opción B cambia el modelo de despliegue.
