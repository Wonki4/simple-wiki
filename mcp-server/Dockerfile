# simple-wiki MCP 서버(streamable-http) 이미지
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
COPY src ./src
# prepare 스크립트(자동 빌드) 대신 명시적으로 빌드 후 dev 의존성 정리
RUN npm install --ignore-scripts && npm run build && npm prune --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# 컨테이너 안에서는 0.0.0.0 바인딩이 표준(노출은 -p/k8s Service가 통제).
# 베어메탈 실행은 여전히 기본 127.0.0.1(http.ts) 이며, 필요 시 HOST로 덮어쓴다.
ENV HOST=0.0.0.0
ENV PORT=3333
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
EXPOSE 3333
# 기본은 원격 HTTP 모드. 각 요청의 Authorization: Bearer <PAT>로 인증한다.
CMD ["node", "dist/http.js"]
