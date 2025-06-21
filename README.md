# api-gateway-pattern
api gateway pattern implementation using node.js

## Development Environment

### Quick Start

1. Clone the repository
```bash
git clone https://github.com/your-org/airank-core.git
cd airank-core
```

2. Install dependencies
```bash
npm install
```

3. Add your ngrok auth token to the `.env` file (optional but recommended for webhook testing)
```
NGROK_AUTHTOKEN=your_token_here
```

4. Start the development environment
```bash
npm run dev
```

This will:
- Start MongoDB
- Initialize ngrok (if auth token is provided)
- Start all services with proper environment variables
- Display webhook URLs for testing

### Webhook Testing

For testing webhooks (like Salesforce integration), use:
```bash
npm run test:webhook:salesforce
```

For more information about webhooks, see [scripts/README.md](scripts/README.md)

## MongoDB Setup

### Local Development with Replica Set

1. Create directories for MongoDB:
```bash
mkdir -p ~/data/db/rs0-0 ~/data/db/rs0-1 ~/data/db/rs0-2
```

2. Start MongoDB instances:
```bash
mongod --replSet rs0 --port 27017 --dbpath ~/data/db/rs0-0 --bind_ip localhost &
mongod --replSet rs0 --port 27018 --dbpath ~/data/db/rs0-1 --bind_ip localhost &
mongod --replSet rs0 --port 27019 --dbpath ~/data/db/rs0-2 --bind_ip localhost &
```

3. Initialize replica set (only needed once):
```bash
mongosh --eval 'rs.initiate({
  _id: "rs0",
  members: [
    { _id: 0, host: "localhost:27017" },
    { _id: 1, host: "localhost:27018" },
    { _id: 2, host: "localhost:27019" }
  ]
})'
```

4. Verify replica set status:
```bash
mongosh --eval "rs.status()"
```

The application will automatically connect to the replica set using the MongoDB URI: `mongodb://localhost:27017`.
