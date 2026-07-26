FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .

FROM node:20-alpine
WORKDIR /app
RUN addgroup -S itms && adduser -S itms -G itms
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server ./server
COPY --from=builder /app/src/lib/firebase-admin.ts ./src/lib/
COPY --from=builder /app/src/lib/supabase-server.ts ./src/lib/
COPY --from=builder /app/tsconfig.json ./
USER itms
EXPOSE 3001
EXPOSE 9090
ENV NODE_ENV=production
CMD ["npx", "tsx", "server/index.ts"]
