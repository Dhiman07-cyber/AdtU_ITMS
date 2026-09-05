# Stage 1: Build & dependency stage
FROM node:22-alpine AS builder
WORKDIR /app

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    NPM_CONFIG_LOGLEVEL=error \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false

COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm install --legacy-peer-deps --no-fund --no-audit && \
    rm -rf node_modules/puppeteer node_modules/puppeteer-core node_modules/next node_modules/@next node_modules/vitest node_modules/tailwindcss node_modules/@tailwindcss node_modules/maplibre-gl node_modules/leaflet node_modules/recharts node_modules/framer-motion node_modules/exceljs node_modules/jspdf node_modules/cloudinary

COPY server ./server
COPY src ./src
COPY tsconfig.json ./

# Stage 2: Production runtime stage
FROM node:22-alpine AS runner
WORKDIR /app

LABEL org.opencontainers.image.title="ITMS WebSocket Server" \
      org.opencontainers.image.description="Dedicated Realtime Transport Service for ITMS" \
      org.opencontainers.image.vendor="ADTU Bus Services"

RUN addgroup -S -g 10001 itms && adduser -S -u 10001 -G itms itms

COPY --from=builder --chown=itms:itms /app/node_modules ./node_modules
COPY --from=builder --chown=itms:itms /app/server ./server
COPY --from=builder --chown=itms:itms /app/src ./src
COPY --from=builder --chown=itms:itms /app/tsconfig.json ./

USER itms

EXPOSE 3001 9090

ENV NODE_ENV=production \
    WS_PORT=3001 \
    HEALTH_PORT=9090

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:9090/health/live || exit 1

CMD ["npx", "tsx", "server/index.ts"]
