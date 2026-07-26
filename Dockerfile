# Imagen del sistema: API y pantallas. La instancia es Graviton, así que se
# construye para linux/arm64 — en un Mac con Apple Silicon eso es nativo y rápido.
#
#   docker buildx build --platform linux/arm64 -t <repo>:<sha> --push .
#
# ## Una sola imagen para las dos aplicaciones
#
# Podrían ser dos imágenes y dos repositorios. Van juntas a propósito: el
# frontend y la API comparten `@cci/contracts`, y dos artefactos separados
# admiten la combinación en la que uno se desplegó y el otro no. Con una sola
# etiqueta esa combinación no existe — el servidor y las pantallas que hablan
# con él salen siempre del mismo commit.
#
# El precio es que un cambio de CSS reconstruye también el backend. Barato:
# el build entero tarda menos que diagnosticar una vez por qué la pantalla
# manda un campo que el servidor ya no acepta.
#
# ## Y se construye AQUÍ, no en la instancia
#
# `next build` sobre una t4g pequeña se queda sin memoria y se lleva por
# delante la sesión SSH. Construir en el CI —o en el portátil— y mandar solo el
# resultado evita el problema entero en vez de administrarlo con límites de
# memoria.

FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo

# Manifiestos primero: la capa de dependencias se reusa mientras no cambien.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/gramatica/package.json packages/gramatica/
COPY apps/api/package.json apps/api/
COPY frontend/package.json frontend/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @cci/contracts build \
 && pnpm --filter @cci/gramatica build \
 && pnpm --filter @cci/api build \
 && pnpm deploy --legacy --filter @cci/api --prod /salida

# Los accesos rápidos de la demostración, si se piden.
#
# Vacío por defecto, y entonces los botones NO existen en la página. Se pasa
# explícitamente —`--build-arg ACCESOS_DEMO="1000000001:clave,..."`— y solo para
# la demostración: lo que entra aquí queda escrito en el JavaScript que descarga
# cualquiera. Es una contraseña publicada, y hay que decidirlo a propósito.
ARG ACCESOS_DEMO=""
ENV NEXT_PUBLIC_ACCESOS_DEMO=$ACCESOS_DEMO

# El frontend, después de la API: si el contrato cambió y las pantallas no se
# adaptaron, `next build` falla aquí (ignoreBuildErrors está en false) y la
# imagen no llega a existir.
RUN pnpm --filter @cci/web build


FROM node:22-alpine AS runtime
RUN apk add --no-cache tini curl \
 && addgroup -S cci && adduser -S cci -G cci \
 && curl -fsSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
      -o /etc/ssl/certs/rds-ca.pem \
 && apk del curl

WORKDIR /app
COPY --from=build --chown=cci:cci /salida ./

# ── Las pantallas ────────────────────────────────────────────────────────────
# `output: 'standalone'` deja en `.next/standalone` un servidor con solo las
# dependencias que Next trazó. Los estáticos y `public/` no entran ahí y hay que
# copiarlos aparte: sin ellos el servidor arranca y sirve HTML sin estilos, que
# es peor que no arrancar.
COPY --from=build --chown=cci:cci /repo/frontend/.next/standalone ./web
COPY --from=build --chown=cci:cci /repo/frontend/.next/static ./web/frontend/.next/static
COPY --from=build --chown=cci:cci /repo/frontend/public ./web/frontend/public

# Las migraciones viajan en la imagen: la base solo es alcanzable desde la VPC,
# así que `pnpm db:migrate` se ejecuta desde aquí, no desde el portátil de nadie.
COPY --from=build --chown=cci:cci /repo/apps/api/drizzle ./drizzle
COPY --from=build --chown=cci:cci /repo/apps/api/scripts ./scripts

# El inventario del cliente viaja en la imagen: las semillas se aplican desde
# dentro de la VPC, igual que las migraciones.
COPY --from=build --chown=cci:cci /repo/apps/api/datos ./datos

# La configuración de nginx también viaja aquí, y la instancia la SACA de la
# imagen al desplegar. Así el reparto de rutas queda atado a la misma etiqueta
# que el código que lo cumple: no existe la versión en la que se añadió un
# controlador pero la instancia sigue con el nginx anterior.
COPY --from=build --chown=cci:cci /repo/infra/nginx.conf ./nginx.conf

USER cci
ENV NODE_ENV=production API_PORT=3000 DRIZZLE_DIR=/app/drizzle \
    RDS_CA_PATH=/etc/ssl/certs/rds-ca.pem \
    ARCHIVO_STOCK=/app/datos/bodegas-y-stock.xlsx
EXPOSE 3000

# tini como PID 1: reenvía SIGTERM para que el cierre sea ordenado y el
# despachador del outbox no quede a medias.
ENTRYPOINT ["/sbin/tini", "--"]

#   API:          (por defecto)
#   Pantallas:    docker run ... <imagen> node web/frontend/server.js
#   Migraciones:  docker run ... <imagen> node dist/scripts/migrar.js up
#   Semillas:     docker run ... <imagen> node dist/scripts/semillas.js
CMD ["node", "dist/src/main.js"]
