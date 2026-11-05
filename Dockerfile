FROM node:20-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev

ADD https://github.com/benbjohnson/litestream/releases/download/v0.3.13/litestream-v0.3.13-linux-amd64.tar.gz /tmp/litestream.tar.gz
RUN tar -C /usr/local/bin -xzf /tmp/litestream.tar.gz && rm -f /tmp/litestream.tar.gz

FROM node:20-slim
WORKDIR /app
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /usr/local/bin/litestream /usr/local/bin/litestream
COPY --from=build /app/node_modules ./node_modules
COPY package*.json ./
COPY litestream.yml /etc/litestream.yml
COPY scripts/ ./scripts/
COPY server.js ./
COPY src/ ./src/

RUN chmod +x ./scripts/docker-entrypoint.sh
RUN mkdir -p /data && chown -R node:node /app /data
USER node

ENV NODE_ENV=production
ENV PORT=8080
ENV DB_PATH=/data/telemetry.db
EXPOSE 8080

ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
CMD ["node", "server.js"]
