# Binário estático do MediaMTX (servidor de mídia battle-tested)
FROM bluenviron/mediamtx:1.9.3 AS mediamtx

FROM node:20-alpine

COPY --from=mediamtx /mediamtx /usr/local/bin/mediamtx

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY server.js ./
COPY public ./public

EXPOSE 8080

CMD ["node", "server.js"]
