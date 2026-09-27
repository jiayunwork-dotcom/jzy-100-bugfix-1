# 关键词抽取服务镜像
# 构建阶段也承担“容器内跑通自动化测试”的验收要求：测试失败则镜像构建失败。
FROM node:20-bookworm-slim

WORKDIR /app

# 先拷依赖清单，利用层缓存安装依赖（含 devDependencies，构建与测试需要）
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 拷贝源码与测试，在容器内跑自动化测试，跑不通直接让构建失败
COPY tsconfig.json tsconfig.test.json ./
COPY src ./src
COPY test ./test
RUN npm test

# 编译为 dist/ 产物
RUN npm run build

# 接口绑定固定端口 8080（src/server.ts 中同样默认 8080）
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# 健康检查（Fastify 提供 /health）
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
