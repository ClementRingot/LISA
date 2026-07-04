# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:26-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY packages/core/package.json   ./packages/core/package.json
COPY packages/server/package.json ./packages/server/package.json
RUN npm ci --workspace packages/core --workspace packages/server

COPY packages/core/tsconfig.json        ./packages/core/tsconfig.json
COPY packages/core/src/                 ./packages/core/src/
COPY packages/server/tsconfig.json      ./packages/server/tsconfig.json
COPY packages/server/esbuild.config.mjs ./packages/server/esbuild.config.mjs
COPY packages/server/src/               ./packages/server/src/
RUN npm run build --workspace packages/core --workspace packages/server && npm prune --omit=dev

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:26-alpine

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

# Container-shaped defaults only. SAP_I18N_SERVICE_PATH and SAP_CLIENT are NOT
# set here on purpose: the code's own defaults (/sap/bc/http/sap/zi18n_service,
# client 000) apply, and an ENV baked into the image would silently override
# them — a previous image shipped a wrong path exactly that way.
ENV MCP_TRANSPORT=http-streamable \
    PORT=8080 \
    LOG_FORMAT=json \
    LOG_LEVEL=info

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "packages/server/dist/index.js"]
