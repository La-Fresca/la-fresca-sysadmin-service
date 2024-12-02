FROM node:18-alpine
ENV NODE_ENV=production

RUN apk add --no-cache bash curl mongodb-tools && \
    corepack enable && \
    corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --prod

COPY . .

EXPOSE 3000

CMD ["node", "index.js"]
