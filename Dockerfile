# Stage 1: Install dependencies only when needed
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: Rebuild the source code only when needed
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV NEXT_PUBLIC_FIREBASE_PROJECT_ID=prod
ENV NEXT_PUBLIC_SUPABASE_URL=https://prod.supabase.co
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=prod

RUN npm run build

# Stage 3: Production runner image
FROM node:22-alpine AS runner
WORKDIR /app

LABEL org.opencontainers.image.title="ITMS Next.js Web App" \
      org.opencontainers.image.description="Intelligent Transportation Management System Frontend & Edge API" \
      org.opencontainers.image.vendor="ADTU Bus Services"

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

RUN mkdir .next
RUN chown nextjs:nodejs .next

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
