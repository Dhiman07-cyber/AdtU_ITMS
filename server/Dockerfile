# Stage 1: Build & dependency stage
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY server ./server
COPY src/lib/observability ./src/lib/observability
COPY src/lib/firebase-admin.ts ./src/lib/
COPY src/lib/supabase-server.ts ./src/lib/
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
COPY --from=builder --chown=itms:itms /app/src/lib ./src/lib
COPY --from=builder --chown=itms:itms /app/tsconfig.json ./

USER itms

EXPOSE 3001 9090

ENV NODE_ENV=production \
    WS_PORT=3001 \
    HEALTH_PORT=9090

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:9090/health/live || exit 1

CMD ["npx", "tsx", "server/index.ts"]
