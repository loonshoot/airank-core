# AIRank Core

AI-powered ranking system with cost-optimized batch processing for OpenAI, Claude, and Gemini models.

## 🚀 Features

- **Batch Processing**: 50% cost savings using OpenAI Batch API and Vertex AI batch prediction
- **Multi-Provider**: Supports OpenAI, Claude (via Vertex AI), and Gemini
- **Automatic Routing**: Recurring jobs use batching, immediate jobs use real-time API
- **Change Stream Listeners**: MongoDB change streams for real-time batch result processing
- **Sentiment Analysis**: Automatic brand sentiment analysis on all results

## 📦 Batch Processing Quick Start

```bash
# 1. Run setup (creates GCS bucket, Pub/Sub, service accounts)
./scripts/setup-gcp-batch-infrastructure.sh

# 2. Run pre-flight checks
./scripts/test-batch-system.sh

# 3. Start services
# Terminal 1: cd graphql && npm start
# Terminal 2: cd batcher && npm start
# Terminal 3: cd listener && npm start
```

**Full documentation:**
- 📖 [Quick Start Guide](BATCH_QUICKSTART.md)
- 📖 [Complete Setup Guide](docs/BATCH_SETUP_GUIDE.md)
- 📖 [Architecture Documentation](docs/BATCH_PROCESSING.md)

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
