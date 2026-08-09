# syntax=docker/dockerfile:1
# ===== 依赖安装阶段 =====
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ===== 构建阶段 =====
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG BASE_PATH=""
ENV NEXT_PUBLIC_BASE_PATH=$BASE_PATH
RUN npm run build

# ===== 运行阶段（standalone 输出） =====
FROM node:22-alpine AS runner
WORKDIR /app
ARG BASE_PATH=""
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV NEXT_PUBLIC_BASE_PATH=$BASE_PATH

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# 本应用无 public/ 静态资源目录（图标在 src/app/icon.svg），故不复制 public
RUN mkdir -p /app/data

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3   CMD node -e "fetch('http://127.0.0.1:3000'+(process.env.NEXT_PUBLIC_BASE_PATH||'')+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
