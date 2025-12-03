FROM oven/bun:1

WORKDIR /app

# Install git
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Copy and install config package first
COPY config /app/config/
WORKDIR /app/config
RUN bun install
RUN bun pm pack

# Install service
WORKDIR /app
COPY listener/package*.json ./
RUN bun install
RUN bun add /app/config/*.tgz

COPY listener/ .

COPY scripts/setup-gcp-env.sh /usr/local/bin/setup-gcp-env.sh
RUN chmod +x /usr/local/bin/setup-gcp-env.sh

CMD ["/usr/local/bin/setup-gcp-env.sh", "bun", "run", "index.js"]
