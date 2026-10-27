# 后端镜像：Node 24（内置 node:sqlite）+ 中文字体（PDF 实验报告）
FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@12.8.1

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/scoring/package.json packages/scoring/
COPY packages/sim-core/package.json packages/sim-core/
RUN pnpm install --frozen-lockfile --filter @zhian/server...

COPY packages packages
COPY apps/server apps/server

ENV NODE_ENV=production \
    API_PORT=8788
WORKDIR /app/apps/server
# 数据库、加密密钥与初始账号文件都写在这里，务必挂载持久卷
VOLUME ["/app/apps/server/data"]
EXPOSE 8788
CMD ["node_modules/.bin/tsx", "src/index.ts"]
