FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM mcr.microsoft.com/playwright:v1.60.0-jammy
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server/ ./server/
# The one-off backfills in here are documented as `docker exec <container> node
# scripts/<name>.js`, which only works if they are actually in the image.
COPY scripts/ ./scripts/
COPY --from=build /app/dist ./dist
EXPOSE 3016
CMD ["node", "server/index.js"]
