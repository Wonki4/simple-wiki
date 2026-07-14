FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json prisma ./
# --ignore-scripts: @prisma/engines 등의 postinstall 이 엔진 바이너리를 CDN에서
# 받으려는 시도를 막는다(에어갭에서 실패 원인). 엔진은 prisma/engines/ 에 vendored
# 되어 있고 아래 builder 단계에서 env 로 지정한다. 이 저장소의 postinstall
# (prisma generate)도 건너뛰지만 builder 단계에서 명시적으로 다시 실행한다.
RUN npm ci --ignore-scripts

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# vendored 엔진을 Prisma 가 쓰도록 지정 → prisma generate 가 네트워크 없이 동작한다.
ENV PRISMA_QUERY_ENGINE_LIBRARY=/app/prisma/engines/libquery_engine-linux-musl-openssl-3.0.x.so.node
ENV PRISMA_SCHEMA_ENGINE_BINARY=/app/prisma/engines/schema-engine-linux-musl-openssl-3.0.x
RUN npx prisma generate && npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# 컨테이너에서 standalone 서버가 0.0.0.0 에 바인딩하도록
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
# 런타임 prisma migrate deploy 가 vendored schema-engine 을 쓰도록(오프라인).
# prisma/engines/ 는 아래 COPY --from=builder /app/prisma 로 이미지에 포함된다.
ENV PRISMA_QUERY_ENGINE_LIBRARY=/app/prisma/engines/libquery_engine-linux-musl-openssl-3.0.x.so.node
ENV PRISMA_SCHEMA_ENGINE_BINARY=/app/prisma/engines/schema-engine-linux-musl-openssl-3.0.x
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
# 전체 node_modules 를 그대로 사용한다: standalone 런타임 + prisma CLI(migrate deploy)가
# 필요로 하는 전체 의존성 클로저(effect, @prisma/config 등)를 함께 확보하기 위함.
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
CMD ["node", "server.js"]
