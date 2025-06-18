FROM node:20-slim

WORKDIR /app

# Copy and install dependencies
COPY mcp/package*.json ./
RUN npm install

# Copy MCP server code
COPY mcp/ .

EXPOSE 3004
CMD ["node", "index.js"] 