# syntax=docker/dockerfile:1.7

# --- builder: install deps + build all packages ---
# Multi-arch: builds natively on arm64 (e.g. Oracle Cloud Ampere A1) or x86_64.
# better-sqlite3 has no prebuilt for alpine+arm64 + Node 20, so we always
# compile it from source — python3/make/g++ below cover that.
FROM node:20-alpine AS builder
RUN apk add --no-cache python3 make g++ libc6-compat
WORKDIR /app

# Enable pnpm via corepack and pin the version that matches package.json.
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# Copy lockfile + manifests first for cache reuse.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/client/package.json packages/client/
COPY packages/server/package.json packages/server/

RUN pnpm install --frozen-lockfile || pnpm install

# Now copy sources and build.
COPY packages/shared packages/shared
COPY packages/client packages/client
COPY packages/server packages/server
COPY talent_data.json ./

RUN pnpm --filter @holodle/shared build \
 && pnpm --filter @holodle/client build \
 && pnpm --filter @holodle/server build

# --- runner: prod deps only + built artifacts ---
# better-sqlite3 has no musl+arm64 prebuilt, so the prod `pnpm install` below
# rebuilds it from source — keep python3/make/g++ in this stage too.
FROM node:20-alpine AS runner
RUN apk add --no-cache python3 make g++ libc6-compat
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV DB_PATH=/data/holodle.db

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/

RUN pnpm install --prod --frozen-lockfile --filter @holodle/server... || pnpm install --prod --filter @holodle/server...

COPY --from=builder /app/packages/shared/src packages/shared/src
COPY --from=builder /app/packages/server/dist packages/server/dist
COPY --from=builder /app/packages/client/dist packages/client/dist
COPY --from=builder /app/talent_data.json ./talent_data.json

VOLUME ["/data"]
EXPOSE 3001
CMD ["node", "packages/server/dist/index.js"]
