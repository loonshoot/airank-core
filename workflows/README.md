# AI Rank Workflow Service

This service handles the execution of AI workflows created in the AI Rank app. It runs as a separate Docker container to isolate AI processing from the UI.

## Features

- **AI Agent Execution**: OpenAI Agents SDK integration for LLM workflows
- **Non-AI Operations**: Webhooks, parsers, transformers that cost $0 to run
- **RESTful API**: HTTP interface for workflow execution
- **Cost-Effective**: Only uses LLM APIs when intelligent reasoning is needed

## API Endpoints

### `POST /execute`
Execute a workflow with nodes and edges.

**Request Body:**
```json
{
  "nodes": [...],
  "edges": [...]
}
```

**Response:**
```json
{
  "success": true,
  "result": { ... },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### `GET /agents`
Get list of available AI agents.

### `GET /health`
Service health check.

## Supported Node Types

- **ai-agent**: LLM-powered intelligent processing
- **webhook**: HTTP API calls
- **parser**: Data parsing (JSON, XML, CSV, text)  
- **transformer**: Data transformation
- **condition**: Conditional logic
- **trigger**: Workflow start point
- **destination**: Workflow end point

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Start with Docker
docker-compose up workflows
```

## Environment Variables

- `PORT`: Service port (default: 3005)
- `NODE_ENV`: Environment (development/production)
- OpenAI API keys for agent execution

## Integration

The airank-app communicates with this service via the `WorkflowClient` class:

```typescript
import { workflowClient } from '@/lib/agents/WorkflowClient'

const result = await workflowClient.executeWorkflow(nodes, edges)
``` 