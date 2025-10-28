# Environment Variables Setup

This document explains the environment variables required for airank-core.

## Production (Dokploy)

All environment variables are configured in a **single flat .env file** in Dokploy.

### Required Variables

#### Google Cloud Platform (Vertex AI)
These are **REQUIRED** for sentiment analysis and Gemini model support:

```bash
GOOGLE_CLOUD_PROJECT_ID=aitrack-production
GOOGLE_CLOUD_LOCATION=us-east5
GCP_SERVICE_ACCOUNT_KEY=<paste entire JSON service account key>
```

**Note:** The `GCP_SERVICE_ACCOUNT_KEY` should be the full JSON content of your service account key file:
```json
{
  "type": "service_account",
  "project_id": "aitrack-production",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "...",
  ...
}
```

#### OpenAI
```bash
OPENAI_API_KEY=sk-proj-...
```

#### MongoDB & Redis
```bash
MONGODB_URI=mongodb://...
MONGODB_PARAMS=authSource=admin&directConnection=true
REDIS_URL=redis://...
```

#### Stripe
```bash
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
```

### Optional Variables
```bash
JWT_SECRET=...
CRYPTO_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

## Local Development

Local development uses the **single root `.env` file** (same as production).

All services (api-gateway, graphql, batcher, listener) read from the root `.env` file via docker-compose.

### Setup
1. Copy `.env.example` to `.env`
2. Fill in your values
3. Run `docker-compose up`

## Troubleshooting

### "Google Cloud Project ID not found"
- Ensure `GOOGLE_CLOUD_PROJECT_ID` is set in your environment
- Verify the variable name is exactly `GOOGLE_CLOUD_PROJECT_ID` (not `GCP_PROJECT_ID`)

### "Google provider not available"
- Check that `GOOGLE_CLOUD_PROJECT_ID` is set
- Verify `GCP_SERVICE_ACCOUNT_KEY` contains valid JSON
- Ensure the service account has Vertex AI permissions

### Model provider not available
- For OpenAI models: Check `OPENAI_API_KEY` is set
- For Gemini/Claude models: Check all GCP variables are set correctly
