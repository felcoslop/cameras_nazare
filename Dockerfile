FROM node:20-alpine

RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY server.js ./
COPY public ./public

EXPOSE 8080
EXPOSE 1935

CMD ["node", "server.js"]
