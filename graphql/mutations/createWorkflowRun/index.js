const mongoose = require('mongoose');
const { Member } = require('../../queries/member');
const { WorkflowRun } = require('../../../common/schemas/workflow');
const { v4: uuidv4 } = require('uuid');

async function createWorkspaceConnection(workspaceId) {
  const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
  const connection = mongoose.createConnection(dataLakeUri);
  await connection.asPromise();
  return connection;
}

async function createWorkflowRun(parent, args, { user }) {
  if (!user?.sub) {
    console.error('User not authenticated');
    return null;
  }

  const workspaceId = args.workspaceId;

  try {
    // Check permissions (allow API keys and bypass member check for system operations)
    if (!user.bypassMemberCheck) {
      const member = await Member.findOne({
        workspaceId: workspaceId,
        userId: user.sub,
        permissions: "mutation:createWorkflowRun"
      });

      if (!member) {
        console.error('User not authorized to create workflow runs');
        return null;
      }
    }

    // Validate required fields
    if (!args.workflowId) {
      throw new Error('Missing required field: workflowId');
    }

    // Connect to workspace database
    const workspaceConnection = await createWorkspaceConnection(workspaceId);
    const WorkflowRunModel = workspaceConnection.model('WorkflowRun', WorkflowRun.schema);

    // Create the workflow run object
    const runId = uuidv4();
    const newWorkflowRun = new WorkflowRunModel({
      id: runId,
      workflowId: args.workflowId,
      workspaceId: workspaceId,
      status: 'queued',
      triggeredBy: {
        type: args.triggeredBy?.type || 'manual',
        source: args.triggeredBy?.source,
        payload: args.triggeredBy?.payload
      },
      input: args.input || {},
      steps: [],
      usage: {
        aiTokensUsed: 0,
        estimatedCost: 0,
        webhooksCalled: 0,
        dataParsed: 0
      }
    });

    // Save the workflow run
    await newWorkflowRun.save();
    await workspaceConnection.close();

    // Return the newly created workflow run
    return {
      id: newWorkflowRun.id,
      workflowId: newWorkflowRun.workflowId,
      workspaceId: newWorkflowRun.workspaceId,
      status: newWorkflowRun.status,
      startedAt: newWorkflowRun.startedAt,
      completedAt: newWorkflowRun.completedAt,
      duration: newWorkflowRun.duration,
      triggeredBy: newWorkflowRun.triggeredBy,
      input: newWorkflowRun.input,
      output: newWorkflowRun.output,
      error: newWorkflowRun.error,
      steps: newWorkflowRun.steps,
      usage: newWorkflowRun.usage,
      createdAt: newWorkflowRun.createdAt.toISOString(),
      updatedAt: newWorkflowRun.updatedAt.toISOString()
    };
  } catch (error) {
    console.error('Error creating workflow run:', error);
    throw error;
  }
}

module.exports = { createWorkflowRun }; 