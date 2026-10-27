# 前端镜像：构建静态文件后由 nginx 提供，/api 与 /ilab 反向代理到后端
FROM node:24-bookworm-slim AS build
RUN npm install -g pnpm@12.8.1
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/scoring/package.json packages/scoring/
COPY packages/sim-core/package.json packages/sim-core/
RUN pnpm install --frozen-lockfile --filter @zhian/web...
COPY packages packages
COPY apps/web apps/web
RUN pnpm --filter @zhian/web build

FROM nginx:1.27-alpine
# 后端地址可用环境变量 API_UPSTREAM 覆盖（默认 docker compose 中的 server 服务）
ENV API_UPSTREAM=http://server:8788
COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
