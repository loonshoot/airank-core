FROM oven/bun:1

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
    bun install && \
    echo "Config package installed successfully" && \
    bun pm pack && \
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
    bun install && \
    echo "Batcher dependencies installed successfully" && \
    echo "Installing local config package..." && \
    ls -la /app/config/*.tgz && \
    bun add /app/config/*.tgz && \
    echo "Local config package installed successfully"

COPY batcher/ .

# Copy config directory for job discovery (batcher needs direct access to config/jobs)
# This is separate from the npm packaged config
COPY config /app/config/

# Copy graphql helpers needed by promptModelTester job
COPY graphql/mutations/helpers /app/graphql/mutations/helpers/

COPY scripts/setup-gcp-env.sh /usr/local/bin/setup-gcp-env.sh
RUN chmod +x /usr/local/bin/setup-gcp-env.sh

CMD ["/usr/local/bin/setup-gcp-env.sh", "bun", "run", "start"] 