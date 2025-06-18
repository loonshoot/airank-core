FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY common/ ./common/
COPY workflows/ ./workflows/

# Install dependencies
RUN npm ci --only=production

# Expose port
EXPOSE 3005

# Start the service
CMD ["node", "workflows/server.js"] 