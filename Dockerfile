# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
# The build needs devDependencies (vite, tsc); the runtime stage does not inherit them.
RUN npm ci --ignore-scripts

COPY tsconfig.json tsconfig.build.json vite.config.ts ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# The image ships no fonts, and the card names its families by hand. Without these the PNG
# rasterizes with the type missing — and the type is the card.
COPY assets ./assets

USER node
EXPOSE 8080
CMD ["node", "dist/server/index.js"]
