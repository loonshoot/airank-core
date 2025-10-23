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
RUN echo "===============================================" && \
    echo "Installing config package dependencies..." && \
    echo "Working directory: $(pwd)" && \
    echo "Package.json contents:" && \
    cat package.json && \
    echo "===============================================" && \
    npm install --verbose --no-audit --no-fund --loglevel=verbose && \
    echo "Config package installed successfully" && \
    npm pack && \
    echo "Config package packed successfully"

# Install batcher service
WORKDIR /app
COPY batcher/package*.json ./
RUN echo "===============================================" && \
    echo "Installing batcher service dependencies..." && \
    echo "Working directory: $(pwd)" && \
    echo "Package.json contents:" && \
    cat package.json && \
    echo "===============================================" && \
    npm install --verbose --no-audit --no-fund --loglevel=verbose && \
    echo "Batcher dependencies installed successfully" && \
    echo "Installing local config package..." && \
    ls -la /app/config/*.tgz && \
    npm install /app/config/*.tgz --verbose --loglevel=verbose && \
    echo "Local config package installed successfully"

COPY batcher/ .
COPY scripts/setup-gcp-env.sh /usr/local/bin/setup-gcp-env.sh
RUN chmod +x /usr/local/bin/setup-gcp-env.sh

CMD ["/usr/local/bin/setup-gcp-env.sh", "npm", "start"] 