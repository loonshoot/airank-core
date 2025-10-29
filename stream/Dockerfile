FROM node:20-slim

WORKDIR /app

# Copy and install stream service
COPY stream/package*.json ./
RUN npm install

# Copy stream service code
COPY stream/ .

EXPOSE 4003

CMD ["node", "index.js"]
