FROM node:24.13.0-bookworm-slim AS build
WORKDIR /src
RUN corepack enable && corepack prepare pnpm@11.0.5 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/proxy/package.json packages/proxy/package.json
RUN pnpm install --frozen-lockfile
COPY packages/proxy/tsconfig.json packages/proxy/tsconfig.json
COPY packages/proxy/src packages/proxy/src
RUN pnpm --filter @vertexai-proxy/server build
RUN pnpm --filter @vertexai-proxy/server deploy --prod /out
RUN mkdir -p /out/dist && cp -a packages/proxy/dist/. /out/dist/

FROM node:24.13.0-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out /app
USER node
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node","-e","const host=(process.env.PROXY_HOST??'').trim(); const port=process.env.PROXY_PORT||(host?process.env.PORT:undefined)||'8765'; fetch('http://127.0.0.1:'+port+'/healthz').then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/server.js"]
