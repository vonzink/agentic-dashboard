# MSFG Agentic AI Dashboard — API image
# Build:  docker build -t agentic-dashboard-api apps/api
# Run:    docker run -p 4000:4000 --env-file .env agentic-dashboard-api
# Migrations (run before rolling the service): node dist/db/migrate.js
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production APP_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
COPY package.json ./
EXPOSE 4000
USER node
CMD ["node", "dist/index.js"]
