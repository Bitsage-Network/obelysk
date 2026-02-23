# ── Stage 1: Build ──────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /build

COPY package.json tsconfig.json ./
RUN npm install

COPY src/ ./src/
RUN npm run build

# ── Stage 2: Runtime ────────────────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY --from=builder /build/dist/ ./dist/

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s \
  CMD wget -q -O- http://localhost:3001/health || exit 1

CMD ["node", "dist/index.js"]
