# =============================================================================
# LINBO Docker - API Backend
# Node.js REST API with WebSocket support and Prisma ORM
# =============================================================================

# -----------------------------------------------------------------------------
# Build Stage - Generate Prisma Client
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including devDependencies for Prisma CLI)
RUN npm install

# Copy Prisma schema
COPY prisma ./prisma/

# Generate Prisma Client
RUN npx prisma generate

# -----------------------------------------------------------------------------
# Production Stage
# -----------------------------------------------------------------------------
FROM node:20-alpine

LABEL maintainer="LINBO Docker Project"
LABEL description="REST API Backend for LINBO with Prisma ORM"
LABEL version="1.0.0"

# Install runtime dependencies
RUN apk add --no-cache \
    argon2 \
    bash \
    curl \
    dpkg \
    openssh-client \
    openssl \
    rsync \
    tini \
    xz \
    cpio \
    kmod \
    tar

# Create non-root user for security
RUN addgroup -g 1001 -S linbo && \
    adduser -u 1001 -S linbo -G linbo

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm install --omit=dev && \
    npm cache clean --force

# Copy generated Prisma Client from builder
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Copy Prisma schema (needed for migrations)
COPY prisma ./prisma/

# Copy application code
COPY src ./src/

# Create required directories with correct permissions
RUN mkdir -p /srv/linbo /var/log/linuxmuster/linbo /etc/linuxmuster/linbo /var/lib/linuxmuster/linbo /var/cache/linbo /var/lib/linbo/drivers && \
    chown -R linbo:linbo /app /srv/linbo /var/log/linuxmuster/linbo /etc/linuxmuster/linbo /var/lib/linuxmuster/linbo /var/cache/linbo /var/lib/linbo/drivers

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Expose API port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Use tini as init system for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Switch to non-root user
USER linbo

# Start the application
CMD ["node", "src/index.js"]
