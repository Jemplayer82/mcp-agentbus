# Two-stage: compile better-sqlite3 native bindings in the build stage, keep the
# runtime image free of the toolchain.
FROM node:22-trixie-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

FROM node:22-trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY server.js bus.js tools.js schema.sql package.json ./
ENV PORT=3107
EXPOSE 3107
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -sf http://localhost:3107/healthz || exit 1
CMD ["node", "server.js"]
