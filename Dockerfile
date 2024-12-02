FROM node:18-alpine
ENV NODE_ENV=production
ENV TZ=Asia/Colombo

RUN apk add --no-cache bash curl mongodb-tools tzdata && \
    cp /usr/share/zoneinfo/Asia/Colombo /etc/localtime && \
    echo "Asia/Colombo" > /etc/timezone && \
    corepack enable && \
    corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --prod

COPY . .

EXPOSE 3000

CMD ["node", "index.js"]
