FROM oven/bun:1

WORKDIR /app

# Copy and install stream service
COPY stream/package*.json ./
RUN bun install

# Copy stream service code
COPY stream/ .

EXPOSE 4003

CMD ["bun", "run", "index.js"]
