FROM node:20-slim

WORKDIR /app

# Install git
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

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

# Install service
WORKDIR /app
COPY graphql/package*.json ./
RUN echo "===============================================" && \
    echo "Installing graphql service dependencies..." && \
    echo "Working directory: $(pwd)" && \
    echo "Package.json contents:" && \
    cat package.json && \
    echo "===============================================" && \
    npm install --verbose --no-audit --no-fund --loglevel=verbose && \
    echo "GraphQL dependencies installed successfully" && \
    echo "Installing local config package..." && \
    ls -la /app/config/*.tgz && \
    npm install /app/config/*.tgz --verbose --loglevel=verbose && \
    echo "Local config package installed successfully"

COPY graphql/ .

EXPOSE 4002
CMD ["node", "index.js"] 