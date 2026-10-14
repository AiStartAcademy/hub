FROM node:20-alpine AS base

FROM base AS deps

# Chromium, NSS and base fonts for correct rendering
RUN apk add --no-cache \
    libc6-compat \
    openssl \
    ghostscript \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    font-liberation

# Skip the Chrome download during npm install and point to the system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm i

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
# NEXT_PUBLIC_TELEMETRY_URL may be set as a build env; when unset, production
# builds use brand.urls.telemetryCollector from src/config/brand.ts.
ENV NEXT_TELEMETRY_DISABLED=1
RUN export NODE_OPTIONS=--max_old_space_size=4096 ; \
    npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# 1. Runtime packages for Prisma, Ghostscript and Puppeteer via apk
RUN apk add --no-cache \
    openssl \
    sqlite \
    ghostscript \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    font-liberation \
    nano

# 2. Make Puppeteer use the system Chromium instead of downloading one
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# We also copy Prisma internals and config
COPY --from=builder /app/prisma ./prisma
# COPY --from=builder /app/.env ./.env

RUN npm install prisma@6.19.2
COPY start.sh /app/start.sh
RUN mkdir -p /app/data

# Set correct ownership for nextjs runtime and sqlite writes
RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

#CMD ["node", "server.js"]
CMD ["sh", "/app/start.sh"]