# ═══ Catalyst OS Backend — Production Dockerfile ═══
# Multi-stage build for minimal image size

# ─── Stage 1: Build ───
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY . .

# ─── Stage 2: Production ───
FROM node:20-alpine AS production
WORKDIR /app

# Security: non-root user
RUN addgroup -g 1001 catalyst && \
    adduser -u 1001 -G catalyst -s /bin/sh -D catalyst

# Copy only what's needed
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/package.json ./

# Create data directory
RUN mkdir -p /app/data /app/logs && \
    chown -R catalyst:catalyst /app

USER catalyst

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/healthz || exit 1

ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

CMD ["node", "src/server.js"]
