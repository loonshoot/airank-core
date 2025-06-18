# AIRank App Transformation Plan

## 🎯 Project Overview
Transform outrun-app into AIRank-app: a focused brand monitoring frontend that provides users with setup wizards, analytics dashboards, and prompt management for multi-LLM brand sentiment analysis.

## 🎨 Brand Identity & Design System

### Color Scheme
```css
:root {
  --color-paragraph: #211A1D;      /* Main text */
  --color-brand: #51F72B;          /* Primary brand color */
  --color-alt: #37B91A;            /* Subtitles & alts */
  --color-background: #F8F0FB;     /* Main background */
  --color-secondary: #CBD6D3;      /* Secondary elements */
  --color-accent: #43B929;         /* Additional accents */
}
```

### Subscription Plans
- **Small**: $99/month - 5 prompts, weekly execution
- **Medium**: $199/month - 25 prompts, weekly execution  
- **Large**: $299/month - 50 prompts, daily execution
- **XL**: $499/month - 500 prompts, daily execution

## 📋 Implementation Steps

### Phase 1: Project Cleanup & Rebranding
**Goal**: Remove unused code and implement new branding

- [ ] **Update project metadata**:
  - Change `package.json` name to "airank-app"
  - Update descriptions and keywords
  - Modify `README.md` with AIRank branding

- [ ] **Remove unused directories/files**:
  - `src/app/[workspaceSlug]/sources/` - Source management (not needed)
  - `src/app/[workspaceSlug]/destinations/` - Destination management (not needed)
  - `src/app/[workspaceSlug]/workflow/` - Workflow builder (not needed)
  - `src/pages/[workspaceSlug]/data/` - Data explorer (not needed)
  - `src/pages/[workspaceSlug]/streams/` - Stream management (not needed)
  - `src/components/Canvas/` - Workflow canvas components (not needed)
  - `src/components/QueryBuilder.js` - Query builder (not needed)

- [ ] **Update styling system**:
  - Modify `tailwind.config.js` with new color palette
  - Update `src/styles/globals.css` with new design tokens
  - Create `src/styles/airank-theme.css` for brand-specific styles

### Phase 2: Navigation & Layout Restructure
**Goal**: Simplify navigation to focus on core features

- [ ] **Update sidebar navigation** (`src/components/Sidebar/`):
  - **Keep**: Settings (admin, billing, user, account)
  - **Replace with**:
    - 📊 Reporting (dashboard/analytics)
    - 💬 Prompts (prompt management)  
    - 🏢 Competitors (brand/competitor management)

- [ ] **Clean up layout components**:
  - Update `src/layouts/GridLayout.js` for new navigation
  - Modify `src/components/Header/` for AIRank branding
  - Update workspace-level layouts

### Phase 3: Setup Wizard Implementation
**Goal**: Create guided onboarding experience

**Create Directory**: `src/app/[workspaceSlug]/setup/`

#### Wizard Steps
- [ ] **Step 1**: `brand/page.jsx` - Add primary brand
  - Form to input brand name
  - Brand description (optional)
  - Industry selection dropdown
  
- [ ] **Step 2**: `competitors/page.jsx` - Add competitor brands
  - Add multiple competitor names
  - Drag & drop reordering
  - Skip option for later setup

- [ ] **Step 3**: `prompts/page.jsx` - Create monitoring prompts
  - Pre-generated prompt templates based on industry
  - Custom prompt creation
  - Plan-based prompt limits display
  - Preview functionality

- [ ] **Step 4**: `llms/page.jsx` - Select LLM providers
  - Checkbox selection of available LLMs (OpenAI, Anthropic, Google, etc.)
  - API key configuration
  - Rate limit information

- [ ] **Step 5**: `complete/page.jsx` - Setup completion
  - Summary of configuration
  - First job scheduling
  - "Go to Dashboard" button

#### Supporting Components
- [ ] **Wizard Layout**: `layout.jsx`
  - Progress indicator (1 of 5, 2 of 5, etc.)
  - Navigation between steps
  - Save & continue later functionality

### Phase 4: Core Pages Development

#### Dashboard/Reporting Page
**Location**: `src/app/[workspaceSlug]/page.jsx`

- [ ] **Key Metrics Cards**:
  - Total brand mentions this period
  - Sentiment score (positive/negative percentage)
  - Top performing prompts
  - Competitor comparison summary

- [ ] **Charts & Visualizations**:
  - Sentiment trend over time (line chart)
  - Brand mentions vs competitors (bar chart)  
  - Prompt performance heatmap
  - Weekly/monthly comparison

- [ ] **Recent Activity Feed**:
  - Latest LLM responses
  - Sentiment alerts
  - Competitor mention notifications

#### Prompts Management Page
**Location**: `src/app/[workspaceSlug]/prompts/`

- [ ] **Prompt List View**:
  - All prompts with status (active/paused)
  - Last run date and next scheduled run
  - Performance metrics (mentions found, sentiment)
  - Quick actions (pause, edit, delete)

- [ ] **Add/Edit Prompt Form**:
  - Rich text editor for prompt creation
  - Brand placeholder insertion `[BRAND]`, `[COMPETITORS]`
  - LLM provider selection (multi-select)
  - Frequency settings (based on plan)

- [ ] **Prompt Templates**:
  - Industry-specific template library
  - Community-shared prompts
  - Template customization

#### Competitors/Brands Management Page
**Location**: `src/app/[workspaceSlug]/competitors/`

- [ ] **Brand Overview**:
  - Primary brand performance summary
  - Edit brand details
  - Brand mention analytics

- [ ] **Competitor List**:
  - All tracked competitors
  - Performance comparison table
  - Add/remove competitors
  - Competitor mention trends

- [ ] **Competitive Analysis**:
  - Side-by-side brand comparison
  - Sentiment comparison charts
  - Market share of voice analysis

### Phase 5: Components Development

#### Chart Components
**Location**: `src/components/Charts/`

- [ ] **SentimentChart.jsx**:
  - Line chart showing sentiment over time
  - Positive/negative/neutral breakdown
  - Interactive tooltips with details

- [ ] **MentionTrendChart.jsx**:
  - Area chart of brand mentions
  - Multiple brand comparison
  - Date range picker integration

- [ ] **CompetitorComparisonChart.jsx**:
  - Horizontal bar chart
  - Sentiment scores comparison
  - Market share visualization

#### Form Components
**Location**: `src/components/Forms/`

- [ ] **PromptForm.jsx**:
  - Rich text input with brand placeholders
  - LLM provider multi-select
  - Frequency selector with plan limits
  - Preview mode

- [ ] **BrandForm.jsx**:
  - Brand name input with validation
  - Industry dropdown
  - Competitor flag toggle
  - Logo upload (optional)

#### Card Components
**Location**: `src/components/Cards/`

- [ ] **MetricCard.jsx**:
  - Reusable metric display
  - Trend indicators (up/down arrows)
  - Click-through actions

- [ ] **PromptCard.jsx**:
  - Prompt preview with truncation
  - Status indicators
  - Quick action buttons

### Phase 6: GraphQL Integration
**Goal**: Connect frontend to new backend APIs

#### API Operations Files
**Location**: `src/graphql/`

- [ ] **brand-operations.js**:
  ```javascript
  GET_BRANDS, CREATE_BRAND, UPDATE_BRAND, DELETE_BRAND
  ```

- [ ] **prompt-operations.js**:
  ```javascript
  GET_PROMPTS, CREATE_PROMPT, UPDATE_PROMPT, DELETE_PROMPT
  ```

- [ ] **analytics-operations.js**:
  ```javascript
  GET_ANALYTICS, GET_SENTIMENT_TRENDS, GET_COMPETITOR_COMPARISON
  ```

- [ ] **llm-operations.js**:
  ```javascript
  GET_LLM_PROVIDERS, UPDATE_LLM_CONFIG
  ```

#### Custom Hooks
**Location**: `src/hooks/`

- [ ] **useBrands.js**: Brand management hook
- [ ] **usePrompts.js**: Prompt CRUD operations  
- [ ] **useAnalytics.js**: Dashboard data fetching
- [ ] **useSetupWizard.js**: Wizard state management

### Phase 7: Authentication & Routing Updates

#### Setup Wizard Integration
- [ ] **Middleware Enhancement** (`src/middleware.js`):
  - Check setup completion status
  - Redirect incomplete setups to wizard
  - Prevent app access until setup complete

- [ ] **Setup Status Tracking**:
  - Add `setupCompleted` field to user/workspace model
  - Track which wizard steps are completed
  - Allow resuming partial setups

#### Plan-Based Access Control
- [ ] **Plan Enforcement**:
  - Prompt creation limits based on subscription
  - Feature gating for higher tiers
  - Usage tracking and warnings

### Phase 8: Billing & Subscription Updates

#### Pricing Configuration
**Location**: `src/config/subscription-rules/`

- [ ] **Update plan definitions**:
  ```javascript
  const PLANS = {
    small: { price: 99, prompts: 5, frequency: 'weekly' },
    medium: { price: 199, prompts: 25, frequency: 'weekly' },
    large: { price: 299, prompts: 50, frequency: 'daily' },
    xl: { price: 499, prompts: 500, frequency: 'daily' }
  };
  ```

#### Billing UI Updates
- [ ] **Subscription management page**:
  - Current plan display with usage metrics
  - Upgrade/downgrade options
  - Usage warnings and limits
  - Billing history

### Phase 9: User Experience Enhancements

#### Onboarding & Help
- [ ] **Welcome Tour**: Interactive product tour after setup
- [ ] **Help Documentation**: In-app help system
- [ ] **Template Library**: Prompt templates with examples
- [ ] **Success Metrics**: Show user value (mentions found, insights gained)

#### Performance Optimizations
- [ ] **Lazy Loading**: Code splitting for large components
- [ ] **Caching**: Apollo cache optimization for dashboard data
- [ ] **Progressive Enhancement**: Core functionality without JS

## 🔧 Technical Specifications

### Component Structure
```
src/
├── app/
│   └── [workspaceSlug]/
│       ├── setup/               # Setup wizard
│       ├── prompts/            # Prompt management
│       ├── competitors/        # Brand/competitor management  
│       └── page.jsx           # Dashboard
├── components/
│   ├── Charts/                # Data visualization
│   ├── Forms/                 # Form components
│   ├── Cards/                 # Metric & data cards
│   └── Wizard/                # Setup wizard components
└── hooks/
    ├── useBrands.js
    ├── usePrompts.js
    └── useAnalytics.js
```

### Data Flow
```
User Action → GraphQL Mutation → Backend Processing → Real-time Updates → UI Refresh
```

### State Management
- Apollo Client for GraphQL state
- React hooks for local component state
- Context for wizard step management
- Local storage for setup progress persistence

## 📱 Responsive Design
- Mobile-first approach
- Dashboard optimized for tablets
- Setup wizard works on all devices
- Charts responsive and touch-friendly

## 🧪 Testing Strategy
- Component testing with React Testing Library
- Integration tests for setup wizard flow
- E2E tests for critical user journeys
- Visual regression testing for charts

## 📅 Timeline
- **Week 1**: Phase 1-3 (Cleanup, navigation, setup wizard)
- **Week 2**: Phase 4-5 (Core pages, components)
- **Week 3**: Phase 6-7 (GraphQL integration, auth)
- **Week 4**: Phase 8-9 (Billing, UX enhancements)

## 🚀 Launch Readiness
- [ ] Setup wizard fully functional
- [ ] Dashboard displays mock/real data
- [ ] Billing integration complete
- [ ] Mobile responsive
- [ ] Performance optimized
- [ ] Error handling comprehensive 

## 📚 Documentation Updates
- Update API documentation for new endpoints
- Create LLM provider setup guides
- Document job scheduling and monitoring
- Create deployment and scaling guides 
- Create detailed instruction guide a llm working on the frontend could follow.