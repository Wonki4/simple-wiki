FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json prisma ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# 컨테이너에서 standalone 서버가 0.0.0.0 에 바인딩하도록
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
# 전체 node_modules 를 그대로 사용한다: standalone 런타임 + prisma CLI(migrate deploy)가
# 필요로 하는 전체 의존성 클로저(effect, @prisma/config 등)를 함께 확보하기 위함.
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
CMD ["node", "server.js"]
