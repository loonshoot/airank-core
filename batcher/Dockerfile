FROM node:20-slim

WORKDIR /app

# Install git
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Debug: Create directories and show structure
RUN mkdir -p /config /batcher
RUN ls -la /

# Copy and install config package first
COPY config /app/config/
WORKDIR /app/config
RUN npm install
RUN npm pack

# Install batcher service
WORKDIR /app
COPY batcher/package*.json ./
RUN npm install
RUN npm install /app/config/*.tgz

COPY batcher/ .

CMD ["npm", "start"] 