# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY packages/core/package.json           ./packages/core/package.json
COPY packages/arc1-extension/package.json ./packages/arc1-extension/package.json
COPY packages/server/package.json         ./packages/server/package.json
RUN npm ci

COPY packages/core/tsconfig.json           ./packages/core/tsconfig.json
COPY packages/core/src/                    ./packages/core/src/
COPY packages/arc1-extension/tsconfig.json ./packages/arc1-extension/tsconfig.json
COPY packages/arc1-extension/src/          ./packages/arc1-extension/src/
COPY packages/server/tsconfig.json         ./packages/server/tsconfig.json
COPY packages/server/esbuild.config.mjs    ./packages/server/esbuild.config.mjs
COPY packages/server/src/                  ./packages/server/src/
RUN npm run build && npm prune --omit=dev

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine

RUN apk add --no-cache tini ca-certificates \
    && rm -rf /usr/lib/node_modules/npm

WORKDIR /app

COPY --from=builder /app/node_modules             ./node_modules
COPY --from=builder /app/package.json             ./package.json
COPY --from=builder /app/packages/server/dist     ./packages/server/dist
COPY --from=builder /app/packages/server/package.json ./packages/server/package.json

# Non-root user
RUN addgroup -S translator && adduser -S translator -G translator
USER translator

EXPOSE 8080

ENV MCP_TRANSPORT=http-streamable \
    PORT=8080 \
    LOG_FORMAT=json \
    LOG_LEVEL=info \
    SAP_I18N_SERVICE_PATH=/sap/bc/rest/zcl_i18n_service \
    SAP_CLIENT=000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "packages/server/dist/index.js"]
