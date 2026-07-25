# Imagen del backend. La instancia es Graviton, así que se construye para
# linux/arm64 — en un Mac con Apple Silicon eso es nativo y rápido.
#
#   docker buildx build --platform linux/arm64 -t <repo>:<sha> --push .

FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo

# Manifiestos primero: la capa de dependencias se reusa mientras no cambien.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/gramatica/package.json packages/gramatica/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @cci/contracts build \
 && pnpm --filter @cci/gramatica build \
 && pnpm --filter @cci/api build \
 && pnpm deploy --legacy --filter @cci/api --prod /salida


FROM node:22-alpine AS runtime
RUN apk add --no-cache tini curl \
 && addgroup -S cci && adduser -S cci -G cci \
 && curl -fsSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
      -o /etc/ssl/certs/rds-ca.pem \
 && apk del curl

WORKDIR /app
COPY --from=build --chown=cci:cci /salida ./

# Las migraciones viajan en la imagen: la base solo es alcanzable desde la VPC,
# así que `pnpm db:migrate` se ejecuta desde aquí, no desde el portátil de nadie.
COPY --from=build --chown=cci:cci /repo/apps/api/drizzle ./drizzle
COPY --from=build --chown=cci:cci /repo/apps/api/scripts ./scripts

# El inventario del cliente viaja en la imagen: las semillas se aplican desde
# dentro de la VPC, igual que las migraciones.
COPY --from=build --chown=cci:cci /repo/apps/api/datos ./datos

USER cci
ENV NODE_ENV=production API_PORT=3000 DRIZZLE_DIR=/app/drizzle \
    RDS_CA_PATH=/etc/ssl/certs/rds-ca.pem \
    ARCHIVO_STOCK=/app/datos/bodegas-y-stock.xlsx
EXPOSE 3000

# tini como PID 1: reenvía SIGTERM para que el cierre sea ordenado y el
# despachador del outbox no quede a medias.
ENTRYPOINT ["/sbin/tini", "--"]

#   API:          (por defecto)
#   Migraciones:  docker run ... <imagen> node dist/scripts/migrar.js up
#   Semillas:     docker run ... <imagen> node dist/scripts/semillas.js
CMD ["node", "dist/src/main.js"]
