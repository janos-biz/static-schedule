# 1) 빌드: vite build 로 정적 파일(dist)을 만든다.
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.js ./
COPY src ./src
COPY server ./server
RUN npm run build

# 2) 실행: dist 를 내보내면서 계획 파일 API 를 처리한다.
#    server/ 는 외부 의존성이 없어 node_modules 없이 그대로 돈다.
FROM node:20-alpine
WORKDIR /app

# TZ 환경변수(Asia/Seoul)가 실제로 먹히도록. 완료 시각 기록이 한국 시간으로 남는다.
RUN apk add --no-cache tzdata

ENV NODE_ENV=production \
    PLAN_DIR=/data \
    DIST_DIR=/app/dist \
    PORT=5180

COPY --from=build /app/dist ./dist
COPY server ./server
COPY package.json ./

EXPOSE 5180

# 계획 파일 폴더는 반드시 마운트해서 쓴다. (docker-compose.yml 의 volumes 참고)
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:5180/plan-dates > /dev/null || exit 1

CMD ["node", "server/index.mjs"]
