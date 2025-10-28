FROM node:20-slim

WORKDIR /app

# Install git
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Copy and install config package first
COPY config /app/config/
WORKDIR /app/config
RUN npm install
RUN npm pack

# Install service
WORKDIR /app
COPY listener/package*.json ./
RUN npm install
RUN npm install /app/config/*.tgz

COPY listener/ .

COPY scripts/setup-gcp-env.sh /usr/local/bin/setup-gcp-env.sh
RUN chmod +x /usr/local/bin/setup-gcp-env.sh

CMD ["/usr/local/bin/setup-gcp-env.sh", "node", "index.js"]
