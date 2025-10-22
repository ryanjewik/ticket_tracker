# Dockerfile
FROM node:20-bookworm

# If you connect to a remote browser (WSE) with puppeteer-core, skip Chromium download:
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1 \
    NODE_ENV=production \
    SCRAPER_METRICS_PORT=9464

# System deps (generally safe; no heavyweight browsers installed)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    dumb-init \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first for better caching
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY . .

# Build TypeScript (if using TS)
RUN npm run build

# Dockerfile (add before USER node)
RUN mkdir -p /app/.session_data /app/data \
 && chown -R node:node /app/.session_data /app/data


# Run as non-root
USER node

EXPOSE 9464

# Use dumb-init to handle signals properly when stopping the container
ENTRYPOINT ["dumb-init", "--"]

# server.js should start the metrics server and schedule runScrape()
CMD ["node", "dist/server.js"]
