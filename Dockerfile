FROM node:22-slim

# Install build essentials for native modules (Baileys deps)
RUN apt-get update && apt-get install -y \
  python3 \
  make \
  g++ \
  git \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (better cache)
COPY package.json package-lock.json ./
RUN npm ci --production=false

# Copy source
COPY . .

# Build the worker bundle with esbuild
RUN npx esbuild src/whatsapp/worker.ts \
  --bundle \
  --platform=node \
  --format=cjs \
  --conditions=import \
  --outfile=.wa/worker.cjs \
  --sourcemap \
  --log-level=warning

# Create sessions directory
RUN mkdir -p /app/wa-sessions

CMD ["node", ".wa/worker.cjs"]
