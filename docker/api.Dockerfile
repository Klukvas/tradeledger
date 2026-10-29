FROM node:24-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates

FROM base AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY server/package.json ./server/package.json
RUN npm ci --no-audit --no-fund
COPY server ./server
COPY shared ./shared
COPY src/domain ./src/domain
COPY scripts ./scripts
RUN npm run db:generate && npm run server:build

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=development
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 5180
CMD ["npm", "run", "server:start"]
