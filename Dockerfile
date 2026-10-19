FROM node:24.13.0-bookworm-slim AS build
WORKDIR /src
RUN corepack enable && corepack prepare pnpm@11.0.5 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/proxy/package.json packages/proxy/tsconfig.json packages/proxy/
COPY packages/proxy/src packages/proxy/src
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @vertexai-proxy/server build
RUN pnpm --filter @vertexai-proxy/server deploy --prod /out
RUN mkdir -p /out/dist && cp -a packages/proxy/dist/. /out/dist/

FROM node:24.13.0-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out /app
USER node
CMD ["node", "dist/server.js"]
