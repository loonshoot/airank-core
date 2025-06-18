# AIRank Core Transformation Plan

## 🎯 Project Overview
Transform outrun-core into AIRank-core: a focused brand monitoring and sentiment analysis backend that processes prompts through multiple LLM services and analyzes responses for brand mentions and sentiment.

## 🤖 Frontend Instruction Generation System

### NEW Job: `jobs/frontendInstructionGenerator.js`

This job analyzes the airank-app repository state and generates specific, actionable development tasks based on the frontend transformation plan.

#### Purpose:
- Automatically generate frontend development tasks
- Provide step-by-step instructions with code examples  
- Track transformation progress
- Prioritize tasks based on dependencies
- Output structured development guidance

#### Input Sources:
1. **Frontend Transformation Plan** - The detailed roadmap
2. **Current Codebase State** - Git analysis of existing files
3. **Completed Tasks** - Previously finished development work
4. **User Requirements** - Workspace setup and preferences

#### Output Format:
```javascript
{
  taskId: "FE_001",
  phase: "Phase 1 - Cleanup",
  component: "Remove Workflow Components", 
  priority: "high", // high, medium, low
  status: "pending", // pending, in_progress, completed
  estimatedHours: 4,
  dependencies: [],
  instructions: {
    title: "Remove unused workflow components",
    description: "Clean up workflow-related components not needed in AIRank",
    steps: [
      {
        action: "delete",
        target: "src/app/[workspaceSlug]/workflow/",
        reason: "Workflow functionality not needed in AIRank"
      },
      {
        action: "delete", 
        target: "src/components/Canvas/",
        reason: "Canvas components only used for workflows"
      },
      {
        action: "update",
        target: "src/components/Sidebar/menu.js",
        code: `const menuItems = [
  { name: 'Reporting', href: '/reporting', icon: ChartBarIcon },
  { name: 'Prompts', href: '/prompts', icon: ChatBubbleIcon },
  { name: 'Competitors', href: '/competitors', icon: BuildingOfficeIcon }
];`,
        reason: "Simplify navigation to core AIRank features"
      }
    ],
    testingNotes: "Ensure no broken imports remain after deletion",
    documentation: "Update README.md to reflect removed features"
  },
  nextSuggestedTask: "FE_002"
}
```

#### Generated Task Categories:
1. **Cleanup Tasks** - Remove unused files/components
2. **Styling Tasks** - Implement AIRank color scheme and branding
3. **Component Tasks** - Create new React components (charts, forms, cards)
4. **Page Tasks** - Build setup wizard and dashboard pages
5. **API Integration** - Connect to new GraphQL endpoints
6. **Testing Tasks** - Add comprehensive test coverage

#### New GraphQL Endpoints:

```graphql
# Get pending frontend development tasks
query GetFrontendTasks($phase: String, $priority: String) {
  frontendTasks(phase: $phase, priority: $priority) {
    taskId
    phase
    component
    priority
    instructions {
      title
      description
      steps {
        action
        target
        code
        reason
      }
    }
    estimatedHours
    dependencies
  }
}

# Mark task as completed
mutation CompleteFrontendTask($taskId: String!, $completionNotes: String) {
  completeFrontendTask(taskId: $taskId, notes: $completionNotes) {
    success
    nextTask {
      taskId
      title
    }
    progressUpdate {
      phaseCompletion
      totalProgress
    }
  }
}

# Get transformation progress overview
query GetTransformationProgress {
  frontendProgress {
    totalTasks
    completedTasks
    currentPhase
    blockedTasks
    nextPriorityTask {
      taskId
      title
      priority
    }
  }
}
```

#### Database Schema Addition:
```javascript
// Add to config/data/models.js
FrontendTask: {
  id: String,
  taskId: String,
  phase: String,
  component: String,
  priority: String, // high, medium, low
  status: String, // pending, in_progress, completed, blocked
  instructions: {
    title: String,
    description: String,
    steps: [{
      action: String, // delete, create, update
      target: String, // file path
      code: String, // generated code
      reason: String // explanation
    }],
    testingNotes: String,
    documentation: String
  },
  estimatedHours: Number,
  dependencies: [String], // taskIds
  completionNotes: String,
  createdAt: Date,
  completedAt: Date,
  nextSuggestedTask: String
}
```

#### Scheduling:
- **Daily**: 9 AM - Check for new requirements and generate tasks
- **On-demand**: When user completes setup wizard
- **Event-driven**: When backend schema changes
- **Progress-driven**: When dependencies are completed

#### Integration with Development Workflow:
1. **Morning Standup**: Developers query for high-priority tasks
2. **Task Completion**: Mark tasks complete and get next suggestions
3. **Dependency Management**: System prevents starting tasks with incomplete dependencies
4. **Progress Tracking**: Real-time progress updates across transformation
5. **Code Generation**: Tasks include generated code snippets to accelerate development

## 📋 Core Implementation Steps

### Phase 1: Clean Architecture
**Goal**: Remove unnecessary services and simplify codebase

- [ ] **Remove unused services**:
  - `listener/` - Event-driven workflow listener (not needed)
  - `mcp/` - MCP server (not needed) 
  - `stream/` - Data streaming service (not needed)
  - `workflows/` - Workflow execution engine (not needed)

- [ ] **Clean up common directory**:
  - Remove `common/schemas/workflow.js`
  - Keep `common/utils/rateLimiter.js` (useful for API rate limiting)
  - Remove consolidation jobs in `config/common/`

- [ ] **Update configuration**:
  - Modify database connection strings to use `airank` database
  - Simplify `docker-compose.yml` to only include: api-gateway, graphql, batcher
  - Update `app-spec.yaml` to reflect new services

### Phase 2: Database Schema Development
**Goal**: Create new data models for brand monitoring

**Location**: `config/data/models.js`

```javascript
// New Models to Add:
- Brand: { id, name, workspaceId, isCompetitor, createdAt, updatedAt }
- Prompt: { id, text, brandId, workspaceId, frequency, active, llmProviders, createdAt }
- LLMResponse: { id, promptId, brandId, response, sentiment, mentions, date, llmProvider }
- LLMProvider: { id, name, endpoint, apiKey, active, rateLimit }
- Analytics: { id, workspaceId, date, brandMentions, sentiment, competitorData }
- FrontendTask: { id, taskId, phase, component, priority, status, instructions, estimatedHours, dependencies, completionNotes, createdAt, completedAt, nextSuggestedTask }
```

### Phase 3: GraphQL API Restructure
**Goal**: Simplify API to focus on brand monitoring features

**Keep These Endpoints**:
- `queries/workspace/` - Workspace management
- `mutations/createWorkspace/`, `mutations/updateWorkspace/` - Workspace CRUD
- `queries/token/` - Authentication
- `mutations/createApiKey/`, `mutations/updateApiKey/` - API key management

**Remove These Endpoints**:
- All workflow-related queries/mutations
- All source/destination endpoints
- Stream routes
- Job scheduling (replace with new system)

**Create New Endpoints**:

#### Brand Management
- `queries/brands/index.js` - Get all brands and competitors for workspace
- `mutations/createBrand/index.js` - Add new brand or competitor
- `mutations/updateBrand/index.js` - Update brand details
- `mutations/deleteBrand/index.js` - Remove brand

#### Prompt Management
- `queries/prompts/index.js` - Get all prompts for workspace
- `mutations/createPrompt/index.js` - Create prompt (auto-creates jobs)
- `mutations/updatePrompt/index.js` - Update prompt and reschedule jobs
- `mutations/deletePrompt/index.js` - Delete prompt and cancel jobs

#### Analytics & Reporting
- `queries/analytics/index.js` - Get dashboard analytics data
- `queries/reports/index.js` - Get detailed reports by date range

#### LLM Provider Management
- `queries/llmProviders/index.js` - Get available LLM services
- `mutations/updateLLMProvider/index.js` - Configure LLM API keys

#### Frontend Task Management
- `queries/frontendTasks/index.js` - Get pending frontend development tasks
- `mutations/completeFrontendTask/index.js` - Mark task as completed
- `queries/frontendProgress/index.js` - Get transformation progress overview

### Phase 4: Job System Overhaul
**Goal**: Replace complex workflow system with focused LLM processing jobs

**Remove**: All existing jobs in various directories

**Create New Jobs**:

#### Core Processing Jobs
- `jobs/promptExecutor.js`
  - Sends prompts to selected LLM services
  - Handles rate limiting and error retry
  - Stores raw responses in database

- `jobs/sentimentAnalyzer.js`
  - Analyzes LLM responses for sentiment (positive/negative/neutral)
  - Uses secondary LLM call for sentiment analysis
  - Stores sentiment scores and reasoning

- `jobs/brandMentionDetector.js`
  - Scans responses for brand and competitor mentions
  - Counts frequency of mentions
  - Categorizes mention context

- `jobs/dailyReportGenerator.js`
  - Aggregates daily analytics
  - Generates summary reports
  - Triggers notification emails

- `jobs/frontendInstructionGenerator.js`
  - Analyzes the airank-app repository state and generates specific, actionable development tasks

#### Scheduling Jobs
- `jobs/scheduledPromptRunner.js`
  - Runs prompts based on user's plan frequency
  - Manages plan-based limits
  - Queues individual prompt execution jobs

### Phase 5: LLM Service Integration
**Goal**: Create standardized integrations with major LLM providers

**Create Directory**: `config/providers/llm/`

#### Provider Integrations
- `openai.js` - GPT-4, GPT-3.5-turbo integration
- `anthropic.js` - Claude integration  
- `google.js` - Gemini Pro integration
- `meta.js` - Llama integration
- `microsoft.js` - Azure OpenAI integration

#### Service Abstraction
- `llmServiceManager.js` - Unified interface for all providers
- `responseProcessor.js` - Standardizes response formats
- `rateLimitManager.js` - Handles provider-specific rate limits

### Phase 6: Batcher Enhancement
**Goal**: Update job scheduling for new prompt-based system

**Updates to `batcher/`**:
- Add support for frequency-based scheduling (weekly/daily)
- Implement plan-based job limiting
- Add priority queuing for different subscription tiers
- Create job monitoring and failure handling
- Schedule frontend instruction generation

### Phase 7: Database Migration
**Goal**: Update MongoDB collections and indexes

**Collections to Create**:
- `brands` - Brand and competitor data
- `prompts` - User prompts and configuration
- `llm_responses` - Raw LLM responses
- `analytics` - Processed analytics data
- `llm_providers` - LLM service configurations

**Indexes to Add**:
- `brands`: `{ workspaceId: 1, isCompetitor: 1 }`
- `prompts`: `{ workspaceId: 1, active: 1 }`
- `llm_responses`: `{ promptId: 1, date: -1 }`
- `analytics`: `{ workspaceId: 1, date: -1 }`

## 🔧 Technical Specifications

### API Response Formats
```javascript
// Brand Response
{
  id: "brand_123",
  name: "MyBrand",
  workspaceId: "workspace_456", 
  isCompetitor: false,
  createdAt: "2024-01-01T00:00:00Z"
}

// Prompt Response  
{
  id: "prompt_789",
  text: "What are people saying about [BRAND] in the tech industry?",
  brandId: "brand_123",
  frequency: "weekly", // weekly, daily
  llmProviders: ["openai", "anthropic"],
  active: true
}

// Analytics Response
{
  date: "2024-01-01",
  brandMentions: 15,
  sentiment: { positive: 10, negative: 3, neutral: 2 },
  competitorMentions: { "Competitor1": 8, "Competitor2": 12 },
  summary: "Positive sentiment trending up 15% this week"
}
```

### Job Scheduling Logic
```javascript
// Plan-based frequency limits
const PLAN_LIMITS = {
  small: { prompts: 5, frequency: 'weekly' },
  medium: { prompts: 25, frequency: 'weekly' },
  large: { prompts: 50, frequency: 'daily' },
  xl: { prompts: 500, frequency: 'daily' }
};

// NEW: Frontend task generation schedule
const FRONTEND_TASK_SCHEDULE = {
  daily: "0 9 * * *", // 9 AM daily
  onCompletion: "immediate",
  onSetup: "immediate"
};
```

## 📅 Timeline
- **Week 1**: Phase 1-2 (Clean architecture, database models)
- **Week 2**: Phase 3 (GraphQL API restructure) 
- **Week 3**: Phase 4-5 (Job system, LLM integration)
- **Week 4**: Phase 6 (Batcher updates, frontend instruction system)
- **Ongoing**: Frontend instruction generation runs continuously

## 🧪 Testing Strategy
- Unit tests for each LLM provider integration
- Integration tests for job processing pipeline
- Load testing for concurrent prompt processing
- API endpoint testing with various data scenarios
- **NEW**: Testing for frontend instruction generation accuracy

## 📚 Documentation Updates
- Update API documentation for new endpoints
- Create LLM provider setup guides
- Document job scheduling and monitoring
- Create deployment and scaling guides 