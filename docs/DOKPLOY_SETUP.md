# Dokploy Environment Setup

This guide explains how to configure environment variables in Dokploy for the airank-core deployment.

## Required Environment Variables

### GCP Service Account Key (for Batch Processing)

The GCP service account credentials need to be added as an environment variable since Dokploy doesn't support uploading files directly.

1. **Get the JSON key as a single line:**
   ```bash
   cat gcp-batch-processor-key.json | jq -c .
   ```

2. **In Dokploy Dashboard:**
   - Go to your airank-core application
   - Navigate to **Environment** tab
   - Add a new environment variable:
     - **Name:** `GCP_SERVICE_ACCOUNT_KEY`
     - **Value:** Paste the entire JSON output from step 1 (it should be a single line)

   Example format:
   ```
   {"type":"service_account","project_id":"airank-production","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"..."}
   ```

### Other GCP Variables

Add these environment variables for GCP batch processing:

```env
GCP_PROJECT_ID=airank-production
GCP_REGION=us-central1
GCS_BATCH_BUCKET=airank-batch-processing
```

### Complete Environment Variable List

Here are all the environment variables needed for airank-core in Dokploy:

```env
# MongoDB
MONGODB_URI=mongodb+srv://your-connection-string
MONGODB_PARAMS=retryWrites=true&w=majority

# GCP Batch Processing
GCP_SERVICE_ACCOUNT_KEY={"type":"service_account",...}
GCP_PROJECT_ID=airank-production
GCP_REGION=us-central1
GCS_BATCH_BUCKET=airank-batch-processing

# API Gateway
API_GATEWAY_PORT=4001

# OpenAI
OPENAI_API_KEY=sk-...

# Redis (if using)
REDIS_URL=redis://...

# Other API keys as needed
ANTHROPIC_API_KEY=...
```

## How It Works

The application automatically detects the `GCP_SERVICE_ACCOUNT_KEY` environment variable and:

1. Parses the JSON credentials
2. Writes them to a temporary file at `/tmp/gcp-credentials.json`
3. Sets `GOOGLE_APPLICATION_CREDENTIALS` to point to this file
4. All Google Cloud SDK libraries automatically use these credentials

This happens at application startup in:
- `graphql/index.js` - GraphQL service
- `listener/index.js` - Change stream listener service

## Local Development

For local development, you can use the file path method:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/gcp-batch-processor-key.json
```

Or create a `.env` file:
```env
GOOGLE_APPLICATION_CREDENTIALS=/Users/you/dev/airank-core/gcp-batch-processor-key.json
```

The application will automatically use whichever method is available.

## Security Notes

- ✅ The `gcp-batch-processor-key.json` file is in `.gitignore` and will never be committed
- ✅ The environment variable in Dokploy is encrypted and secure
- ✅ The temporary file created in `/tmp` is only accessible by the application process
- ⚠️ Never expose the `GCP_SERVICE_ACCOUNT_KEY` value in logs or error messages
- ⚠️ Make sure to use Dokploy's "Secret" option when adding sensitive env vars

## Verification

After deploying with the environment variable set, check the logs for:

```
✓ GCP credentials configured from environment variable
```

If you see this message, the credentials are properly configured!

## Troubleshooting

### "No GCP credentials found" warning

This means neither `GCP_SERVICE_ACCOUNT_KEY` nor `GOOGLE_APPLICATION_CREDENTIALS` is set.

**Solution:** Add the `GCP_SERVICE_ACCOUNT_KEY` environment variable in Dokploy as described above.

### "Invalid GCP_SERVICE_ACCOUNT_KEY format" error

The JSON is malformed or not properly formatted.

**Solution:**
1. Validate the JSON: `cat gcp-batch-processor-key.json | jq .`
2. Ensure it's a single line when copying to Dokploy: `cat gcp-batch-processor-key.json | jq -c .`
3. Make sure there are no extra quotes or escaping issues

### Batch processing not working

**Check:**
1. All GCP environment variables are set (`GCP_PROJECT_ID`, `GCP_REGION`, `GCS_BATCH_BUCKET`)
2. The service account has the correct permissions (Storage Admin, Vertex AI User)
3. The GCS bucket exists and is in the correct region
4. Check application logs for credential-related errors
