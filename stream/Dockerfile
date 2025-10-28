FROM node:20-slim

WORKDIR /app

# Copy and install stream service
COPY stream/package*.json ./
RUN npm install

# Copy stream service code
COPY stream/ .

# Copy batch helpers (needed for webhook processing)
COPY graphql/mutations/helpers/batch /app/graphql/mutations/helpers/batch

# Setup GCP environment script
COPY scripts/setup-gcp-env.sh /usr/local/bin/setup-gcp-env.sh
RUN chmod +x /usr/local/bin/setup-gcp-env.sh

EXPOSE 4003

CMD ["/usr/local/bin/setup-gcp-env.sh", "node", "index.js"]
