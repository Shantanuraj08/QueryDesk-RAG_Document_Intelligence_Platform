
# Stage 1: Install Dependencies & Generate Prisma

FROM node:20-alpine AS deps
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy dependency specifications and Prisma schema
COPY package.json package-lock.json ./
COPY prisma ./prisma/

# Install exact dependencies and run postinstall (prisma generate)
RUN npm ci

# Stage 2: Production Application Build

FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma Client to ./app/generated/prisma before Next.js build
RUN npx prisma generate

# Disable Next.js telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1

# Compile Next.js in standalone mode
RUN npm run build

# Stage 3: Production Runtime (~120 MB)
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root system user and bind directly to nodejs group
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs nextjs

# Copy static assets
COPY --from=builder /app/public ./public

# Set up .next cache directory with correct permissions
RUN mkdir .next && chown nextjs:nodejs .next

# Copy standalone output and static bundle
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/app/generated/prisma ./app/generated/prisma

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
