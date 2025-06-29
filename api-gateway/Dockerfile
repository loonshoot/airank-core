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
COPY api-gateway/package*.json ./
RUN npm install
RUN npm install /app/config/*.tgz

COPY api-gateway/ .

EXPOSE 4001
CMD ["node", "index.js"]
