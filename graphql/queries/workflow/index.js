const { gql } = require('apollo-server-express');
const mongoose = require('mongoose');
const { Member } = require('../member');

// Import workflow schemas
const { Workflow, WorkflowRun, TriggerListener } = require('../../../common/schemas/workflow');

// Define the workflow typeDefs
const typeDefs = gql`
  type Workflow {
    id: String!
    workspaceId: String!
    name: String!
    description: String
    version: Int!
    status: WorkflowStatus!
    nodes: JSON
    edges: JSON
    triggers: [WorkflowTrigger!]!
    settings: WorkflowSettings
    createdBy: String!
    updatedBy: String
    tags: [String!]
    stats: WorkflowStats
    createdAt: String!
    updatedAt: String!
  }

  type WorkflowTrigger {
    id: String!
    type: TriggerType!
    config: JSON
    active: Boolean!
  }

  type WorkflowSettings {
    timeout: Int
    retryPolicy: RetryPolicy
    concurrency: Int
  }

  type RetryPolicy {
    maxRetries: Int
    backoffStrategy: BackoffStrategy
  }

  type WorkflowStats {
    totalRuns: Int
    successfulRuns: Int
    failedRuns: Int
    lastRun: String
    avgExecutionTime: Float
  }

  type WorkflowRun {
    id: String!
    workflowId: String!
    workspaceId: String!
    status: RunStatus!
    startedAt: String
    completedAt: String
    duration: Int
    triggeredBy: TriggerInfo
    input: JSON
    output: JSON
    error: RunError
    steps: [RunStep!]
    usage: ResourceUsage
    createdAt: String!
    updatedAt: String!
  }

  type TriggerInfo {
    type: TriggerType
    source: String
    payload: JSON
  }

  type RunError {
    message: String
    stack: String
    nodeId: String
  }

  type RunStep {
    nodeId: String!
    nodeType: String!
    status: StepStatus!
    startedAt: String
    completedAt: String
    duration: Int
    input: JSON
    output: JSON
    error: String
    metadata: JSON
  }

  type ResourceUsage {
    aiTokensUsed: Int
    estimatedCost: Float
    webhooksCalled: Int
    dataParsed: Int
  }

  type TriggerListener {
    id: String!
    workflowId: String!
    workspaceId: String!
    triggerType: TriggerType!
    config: TriggerConfig
    active: Boolean!
    lastTriggered: String
    triggerCount: Int
    createdAt: String!
    updatedAt: String!
  }

  type TriggerConfig {
    webhookUrl: String
    webhookSecret: String
    cronExpression: String
    timezone: String
    collection: String
    operation: String
    filter: JSON
  }

  type PaginatedWorkflowRuns {
    runs: [WorkflowRun!]!
    total: Int!
    page: Int!
    limit: Int!
    hasMore: Boolean!
  }

  enum WorkflowStatus {
    draft
    active
    paused
    archived
  }

  enum TriggerType {
    webhook
    schedule
    data_change
    manual
  }

  enum BackoffStrategy {
    linear
    exponential
  }

  enum RunStatus {
    queued
    running
    completed
    failed
    cancelled
    timeout
  }

  enum StepStatus {
    pending
    running
    completed
    failed
    skipped
  }
`;

// Database connection helpers
async function createWorkspaceConnection(workspaceId) {
  const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
  const connection = mongoose.createConnection(dataLakeUri);
  await connection.asPromise();
  return connection;
}

async function createAIRankConnection() {
  const airankUri = `${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`;
  const connection = mongoose.createConnection(airankUri);
  await connection.asPromise();
  return connection;
}

// Define the resolvers
const resolvers = {
  workflows: async (_, { workspaceId, workflowId, page = 1, limit = 20 }, { user }) => {
    console.log('🔍 Workflows resolver called with:', {
      workspaceId,
      workflowId,
      page,
      limit,
      userSub: user?.sub,
      userBypass: user?.bypassMemberCheck
    });

    if (!user?.sub) {
      console.error('❌ User not authenticated');
      return null;
    }

    // Check permissions
    console.log('🔑 Checking member permissions for:', {
      workspaceId,
      userId: user.sub,
      requiredPermission: "query:workflows"
    });

    // First, let's see what members exist for this user in this workspace
    const allMembersForUser = await Member.find({
      workspaceId,
      userId: user.sub
    });

    console.log('🔍 All members for user in workspace:', {
      count: allMembersForUser.length,
      members: allMembersForUser.map(m => ({
        workspaceId: m.workspaceId,
        userId: m.userId,
        permissions: m.permissions
      }))
    });

    const member = await Member.findOne({
      workspaceId,
      userId: user.sub,
      permissions: "query:workflows"
    });

    console.log('👤 Member lookup result:', {
      found: !!member,
      memberData: member ? {
        workspaceId: member.workspaceId,
        userId: member.userId,
        permissions: member.permissions
      } : null,
      bypassCheck: user.bypassMemberCheck
    });

    if (!member && !user.bypassMemberCheck) {
      console.error('❌ User not authorized to query workflows');
      return [];
    }

    try {
      console.log('🗄️ Connecting to workspace database:', `workspace_${workspaceId}`);
      const connection = await createWorkspaceConnection(workspaceId);
      const WorkflowModel = connection.model('Workflow', Workflow.schema);

      if (workflowId) {
        console.log('🔍 Searching for specific workflow:', workflowId);
        const workflow = await WorkflowModel.findOne({ id: workflowId });
        console.log('📄 Single workflow result:', workflow ? 'Found' : 'Not found');
        await connection.close();
        return workflow ? [workflow] : [];
      } else {
        console.log('📋 Searching for all workflows with pagination:', { page, limit });
        const skip = (page - 1) * limit;
        const workflows = await WorkflowModel.find()
          .sort({ updatedAt: -1 })
          .skip(skip)
          .limit(limit);
        
        console.log('📊 Workflows query result:', {
          count: workflows.length,
          workflowIds: workflows.map(w => w.id),
          workflowNames: workflows.map(w => w.name)
        });
        
        await connection.close();
        return workflows;
      }
    } catch (error) {
      console.error('💥 Error querying workflows:', error);
      throw error;
    }
  },

  workflowRuns: async (_, { workspaceId, workflowId, runId, status, page = 1, limit = 20 }, { user }) => {
    if (!user?.sub) {
      console.error('User not authenticated');
      return null;
    }

    // Check permissions
    const member = await Member.findOne({
      workspaceId,
      userId: user.sub,
      permissions: "query:workflows"
    });

    if (!member && !user.bypassMemberCheck) {
      console.error('User not authorized to query workflow runs');
      return null;
    }

    try {
      const connection = await createWorkspaceConnection(workspaceId);
      const WorkflowRunModel = connection.model('WorkflowRun', WorkflowRun.schema);

      const filter = { workspaceId };
      if (workflowId) filter.workflowId = workflowId;
      if (runId) filter.id = runId;
      if (status) filter.status = status;

      if (runId) {
        const run = await WorkflowRunModel.findOne(filter);
        await connection.close();
        return {
          runs: run ? [run] : [],
          total: run ? 1 : 0,
          page: 1,
          limit: 1,
          hasMore: false
        };
      }

      const skip = (page - 1) * limit;
      const [runs, total] = await Promise.all([
        WorkflowRunModel.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        WorkflowRunModel.countDocuments(filter)
      ]);

      await connection.close();

      return {
        runs,
        total,
        page,
        limit,
        hasMore: skip + runs.length < total
      };
    } catch (error) {
      console.error('Error querying workflow runs:', error);
      throw error;
    }
  },

  triggerListeners: async (_, { workspaceId }, { user }) => {
    if (!user?.sub) {
      console.error('User not authenticated');
      return null;
    }

    // Check permissions
    const member = await Member.findOne({
      workspaceId,
      userId: user.sub,
      permissions: "query:workflows"
    });

    if (!member && !user.bypassMemberCheck) {
      console.error('User not authorized to query trigger listeners');
      return null;
    }

    try {
      const connection = await createAIRankConnection();
      const TriggerListenerModel = connection.model('TriggerListener', TriggerListener.schema);

      const listeners = await TriggerListenerModel.find({ workspaceId, active: true });
      await connection.close();

      return listeners;
    } catch (error) {
      console.error('Error querying trigger listeners:', error);
      throw error;
    }
  }
};

module.exports = { typeDefs, resolvers }; 