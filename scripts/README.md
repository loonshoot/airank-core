# Outrun Development Scripts

This directory contains utility scripts for the Outrun development environment.

### Webhook Testing

Outrun supports webhook integration for various services (Salesforce, Hubspot, etc.) through the API Gateway. 

#### Setup

1. Add your ngrok authtoken to your `.env` file:
   ```
   NGROK_AUTHTOKEN=your_token_here
   ```

2. Start the development environment with `npm run dev` - this will:
   - Start ngrok with your auth token
   - Start all services with the ngrok URL passed via environment variables
   - Display webhook URLs you can use for testing

#### How Webhooks Work

- Webhook endpoints are defined in `api-gateway/routes.json` with `headerlessAuth: true`
- The API Gateway routes these requests to the appropriate service without requiring authentication
- During development, webhook URLs are accessible via ngrok (if configured)
- For testing, you can use the included webhook test scripts

#### Testing Salesforce Webhooks

To test Salesforce webhooks:

```bash
npm run test:webhook:salesforce [sourceId] [workspaceId]
```

This script:
1. Finds the ngrok URL from environment variables or fallback sources
2. Constructs a Salesforce webhook URL
3. Sends a sample webhook event to test your implementation

#### Requirements

- Ngrok is optional but recommended for external webhook testing
- If ngrok is not configured, the test script will use localhost, but external services won't be able to reach your endpoint

#### Running Without Ngrok

If you prefer not to use ngrok, you can still run the development environment:

```bash
# Start without ngrok
npm run dev
```

The system will function normally except for receiving external webhooks.

#### Troubleshooting

- **Webhook errors:** Check that your ngrok tunnel is running and the URL is correctly passed to services
- **Connection errors:** Make sure all services are running with `npm run dev`
- **Authentication errors:** Verify that your routes are defined with `headerlessAuth: true` in `routes.json`

## Configuration

* Webhook routes are defined in `api-gateway/routes.json`
* The ngrok tunnel connects to port 3001 by default (API Gateway)
* Webhook URLs are in the format: `https://<ngrok-url>/api/v1/webhook/<service>`
* Available services: `salesforce`, `hubspot`, etc.

## Requirements

* Redis server must be running and accessible
* For external webhook testing, an ngrok authtoken must be configured in .env file

## Running Without Ngrok

If you don't have an ngrok auth token, the system will still function, but external webhooks won't be able to reach your local environment. You can still test the webhook flow locally with:

```
npm run test:webhook:salesforce
```

This will use your local URL, which works for testing but won't receive real external webhook calls.

## Troubleshooting

* If ngrok fails to start, check your .env file for NGROK_AUTHTOKEN
* Make sure Redis is running and accessible via the URL in your .env file
* Check the API gateway logs for incoming requests
* Check the stream service logs for webhook processing

## Adding New Webhook Tests

To add a test for a new service:

1. Create a new script similar to `test-salesforce-webhook.js`
2. Add an entry in package.json: `"test:webhook:yourservice": "node scripts/test-yourservice-webhook.js"`
3. Update the API gateway to handle the new service's webhook
4. Add appropriate handling in the stream service 