FROM node:24.16.0-bookworm-slim AS atlas-build
WORKDIR /atlas
COPY apps/atlas/package.json apps/atlas/package-lock.json ./
RUN npm ci
COPY apps/atlas/index.html apps/atlas/tsconfig.json apps/atlas/tsconfig.app.json apps/atlas/tsconfig.node.json apps/atlas/vite.config.ts ./
COPY apps/atlas/src/main.tsx apps/atlas/src/vite-env.d.ts ./src/
COPY apps/atlas/src/firefly ./src/firefly
RUN npm run build

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.server.json vite.config.ts index.html ./
COPY Design ./Design
COPY public ./public
COPY src ./src
COPY server ./server
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ARG OCI_REVISION=unknown
LABEL org.opencontainers.image.source="https://github.com/yangliu05418-spec/Firefly" \
      org.opencontainers.image.revision=$OCI_REVISION \
      org.opencontainers.image.title="Firefly"
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates python3 make g++ \
    && npm ci --omit=dev \
    && npm cache clean --force \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg \
    && apt-get purge -y --auto-remove python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/dist-web ./dist-web
COPY --from=build /app/dist-server ./dist-server
COPY --from=atlas-build /atlas/dist ./dist-atlas
COPY ops ./ops
EXPOSE 8090
CMD ["node", "dist-server/index.js"]
