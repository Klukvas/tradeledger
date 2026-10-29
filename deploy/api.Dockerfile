FROM node:24-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -r /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY server/package.json ./server/package.json
RUN npm ci --no-audit --no-fund
COPY server ./server
COPY shared ./shared
COPY src/domain ./src/domain
COPY scripts ./scripts
RUN npm run db:generate && npm run server:build

FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -r /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
# Prisma CLI remains available for the separately executed migration job.
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 5180
CMD ["node", "server/dist/server/src/main.js"]
