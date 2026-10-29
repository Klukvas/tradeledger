FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY server/package.json ./server/package.json
RUN npm ci --no-audit --no-fund
COPY . .
ENV VITE_PUBLIC_REGISTRATION=false
RUN npm run typecheck:client && npx vite build

FROM nginx:stable-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -r /var/lib/apt/lists/*
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
