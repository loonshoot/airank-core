FROM oven/bun:1

WORKDIR /app

# Install git and jq for JSON manipulation
RUN apt-get update && apt-get install -y git jq && rm -rf /var/lib/apt/lists/*

# Copy and install config package first
COPY config /app/config/
WORKDIR /app/config
RUN echo "===============================================" && \
    echo "Installing config package dependencies..." && \
    echo "Working directory: $(pwd)" && \
    echo "Package.json contents:" && \
    cat package.json && \
    echo "===============================================" && \
    bun install && \
    echo "Config package installed successfully" && \
    bun pm pack && \
    echo "Config package packed successfully"

# Install service
WORKDIR /app
COPY api-gateway/package*.json ./
# Remove file:../config dependency (will be installed from tgz)
RUN jq 'del(.dependencies["@airank/config"])' package.json > package.tmp.json && mv package.tmp.json package.json
RUN echo "===============================================" && \
    echo "Installing api-gateway service dependencies..." && \
    echo "Working directory: $(pwd)" && \
    echo "Package.json contents:" && \
    cat package.json && \
    echo "===============================================" && \
    bun install && \
    echo "API Gateway dependencies installed successfully" && \
    echo "Installing local config package..." && \
    ls -la /app/config/*.tgz && \
    bun add /app/config/*.tgz && \
    echo "Local config package installed successfully"

COPY api-gateway/ .
COPY scripts/setup-gcp-env.sh /usr/local/bin/setup-gcp-env.sh
RUN chmod +x /usr/local/bin/setup-gcp-env.sh

EXPOSE 4001
CMD ["/usr/local/bin/setup-gcp-env.sh", "bun", "run", "index.js"]
