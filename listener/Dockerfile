FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY common/ ./common/
COPY listener/ ./listener/

# Install dependencies
RUN npm ci --only=production

# Expose port
EXPOSE 3006

# Start the service
CMD ["node", "listener/server.js"] 