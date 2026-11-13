# syntax=docker/dockerfile:1.7-labs
# Build from the repository root:  docker build -f apps/api/Dockerfile -t curtain-api .
# One image = API + merchant API + SDK host + Shopify backend + pg-boss jobs (JOBS=1 → jobs-only replica).
# The base image is pinned exactly (node 22 LTS on alpine 3.24); bump it on purpose, both stages share it.
# NODE_IMAGE is overridable only for a build host that needs its own CA in the image (docs/DEPLOY.md).
ARG NODE_IMAGE=node:22.23.4-alpine3.24

FROM ${NODE_IMAGE} AS base
RUN apk add --no-cache libc6-compat && corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo

# ---- deps: lockfile-exact install of the api and what it imports -----------------------------
# Every workspace manifest is copied (COPY --parents, labs syntax): `pnpm deploy` validates the whole
# workspace, so a missing manifest (packages/anchors, apps/demo-shop, spikes/*) fails the build. The
# install itself is filtered to the api's dependency closure.
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc tsconfig.base.json ./
COPY --parents apps/*/package.json packages/*/package.json spikes/*/package.json ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile --filter '@curtain/api...'

# ---- build: the api and the packages it imports -----------------------------------------------
# `pnpm deploy` copies the api package without its gitignored dist/ (there is no "files" field), so
# dist/ is copied in by hand and the sources and dev configs are dropped; the test guards the layout
# the CMD below relies on.
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
 && pnpm --filter @curtain/api --prod deploy --legacy /out \
 && cp -R apps/api/dist /out/dist \
 && rm -rf /out/src /out/Dockerfile /out/Dockerfile.dockerignore /out/eslint.config.js /out/vitest.config.ts /out/tsconfig*.json \
 && test -f /out/dist/server.js && test -f /out/dist/migrate.js && test -d /out/drizzle

# ---- runtime ------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ARG GIT_SHA=unknown
ENV NODE_ENV=production \
    GIT_SHA=${GIT_SHA} \
    PORT=3000 \
    RENDERS_DIR=/data/renders \
    ASSET_DIR=/data/assets
RUN apk add --no-cache libc6-compat tini && addgroup -S app && adduser -S app -G app \
 && mkdir -p /data/renders /data/assets && chown -R app:app /data
WORKDIR /app
COPY --from=build --chown=app:app /out /app
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/readyz >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
# migrations first, then the server (both read env.ts)
CMD ["sh", "-c", "node dist/migrate.js && node dist/server.js"]
