# syntax=docker/dockerfile:1

# ---- build ------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Install with the lockfile first so dependency layers cache across code changes.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci

COPY . .
RUN npm run build

# Drop dev dependencies from the layer we copy forward.
RUN npm prune --omit=dev

# ---- run --------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV BBC_CLIENT_DIR=/app/client/dist
ENV PORT=8080

# Never run the game as root.
RUN addgroup -S bbc && adduser -S bbc -G bbc

COPY --from=build --chown=bbc:bbc /app/node_modules ./node_modules
COPY --from=build --chown=bbc:bbc /app/package.json ./package.json
COPY --from=build --chown=bbc:bbc /app/shared/dist ./shared/dist
COPY --from=build --chown=bbc:bbc /app/shared/package.json ./shared/package.json
COPY --from=build --chown=bbc:bbc /app/server/dist ./server/dist
COPY --from=build --chown=bbc:bbc /app/server/package.json ./server/package.json
COPY --from=build --chown=bbc:bbc /app/client/dist ./client/dist

USER bbc
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
