# syntax=docker/dockerfile:1.7
# Build from the repository root:  docker build -f apps/api/Dockerfile -t curtain-api .
# One image = API + merchant API + SDK host + Shopify backend + pg-boss jobs (JOBS=1 → jobs-only replica).

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat && corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo

# ---- deps: full workspace install (lockfile-exact) ------------------------------------------
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/schema/package.json packages/schema/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/tryon-providers/package.json packages/tryon-providers/package.json
COPY packages/shopify-app/package.json packages/shopify-app/package.json
COPY packages/fit-engine/package.json packages/fit-engine/package.json
COPY packages/taste-engine/package.json packages/taste-engine/package.json
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

# ---- build: the api and the packages it imports -----------------------------------------------
FROM deps AS build
COPY packages/schema packages/schema
COPY packages/sdk packages/sdk
COPY packages/tryon-providers packages/tryon-providers
COPY packages/shopify-app packages/shopify-app
COPY packages/fit-engine packages/fit-engine
COPY packages/taste-engine packages/taste-engine
COPY apps/api apps/api
RUN pnpm --filter @curtain/schema build \
 && pnpm --filter @curtain/sdk build \
 && pnpm --filter @curtain/tryon-providers build \
 && pnpm --filter @curtain/shopify-app build \
 && pnpm --filter @curtain/api build \
 && pnpm --filter @curtain/api --prod deploy --legacy /out

# ---- runtime ------------------------------------------------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    RENDERS_DIR=/data/renders
RUN apk add --no-cache libc6-compat tini && addgroup -S app && adduser -S app -G app \
 && mkdir -p /data/renders && chown -R app:app /data
WORKDIR /app
COPY --from=build --chown=app:app /out /app
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/readyz >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
# migrations first, then the server (both read env.ts)
CMD ["sh", "-c", "node dist/migrate.js && node dist/server.js"]
