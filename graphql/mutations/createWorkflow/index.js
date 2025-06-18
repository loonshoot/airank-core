const mongoose = require('mongoose');
const { Member } = require('../../queries/member');
const { Workflow, TriggerListener } = require('../../../common/schemas/workflow');
const { v4: uuidv4 } = require('uuid');

// Async function to establish the database connection
async function createWorkspaceConnection(workspaceId) {
  const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
  try {
    const connection = mongoose.createConnection(dataLakeUri);
    await connection.asPromise();
    console.log(`Connected to workspace database: ${dataLakeUri}`);
    return connection;
  } catch (error) {
    console.error('Error connecting to workspace database:', error);
    throw error;
  }
}

async function createOutrunConnection() {
  const outrunUri = `${process.env.MONGODB_URI}/outrun?${process.env.MONGODB_PARAMS}`;
  try {
    const connection = mongoose.createConnection(outrunUri);
    await connection.asPromise();
    return connection;
  } catch (error) {
    console.error('Error connecting to outrun database:', error);
    throw error;
  }
}

// Function to create trigger listeners for a workflow
async function createTriggerListeners(workspaceId, workflowId, triggers) {
  if (!triggers || triggers.length === 0) return;

  try {
    const outrunConnection = await createOutrunConnection();
    const TriggerListenerModel = outrunConnection.model('TriggerListener', TriggerListener.schema);

    const listeners = triggers
      .filter(trigger => trigger.active && trigger.type !== 'manual')
      .map(trigger => ({
        id: uuidv4(),
        workflowId,
        workspaceId,
        triggerType: trigger.type,
        config: trigger.config || {},
        active: true,
        triggerCount: 0
      }));

    if (listeners.length > 0) {
      await TriggerListenerModel.insertMany(listeners);
      console.log(`Created ${listeners.length} trigger listeners for workflow ${workflowId}`);
    }

    await outrunConnection.close();
  } catch (error) {
    console.error('Error creating trigger listeners:', error);
    throw error;
  }
}

// Async function to create a new workflow
async function createWorkflow(parent, args, { user }) {
  if (!user?.sub) {
    console.error('User not authenticated');
    return null;
  }

  const workspaceId = args.workspaceId;
  
  try {
    // Find member with the user's ID and permission
    const member = await Member.findOne({
      workspaceId: workspaceId,
      userId: user.sub,
      permissions: "mutation:createWorkflow"
    });

    if (!member && !user.bypassMemberCheck) {
      console.error('User not authorized to create workflows');
      return null;
    }

    // Validate the input data
    if (!args.name) {
      throw new Error('Missing required field: name');
    }

    // Connect to the workspace database
    const workspaceConnection = await createWorkspaceConnection(workspaceId);
    const WorkflowModel = workspaceConnection.model('Workflow', Workflow.schema);

    // Create the workflow object
    const workflowId = uuidv4();
    const newWorkflow = new WorkflowModel({
      id: workflowId,
      workspaceId: workspaceId,
      name: args.name,
      description: args.description || '',
      version: 1,
      status: 'draft',
      nodes: args.nodes || [],
      edges: args.edges || [],
      triggers: args.triggers || [],
      settings: {
        timeout: args.settings?.timeout || 300000,
        retryPolicy: {
          maxRetries: args.settings?.retryPolicy?.maxRetries || 3,
          backoffStrategy: args.settings?.retryPolicy?.backoffStrategy || 'exponential'
        },
        concurrency: args.settings?.concurrency || 1
      },
      createdBy: user.sub,
      updatedBy: user.sub,
      tags: args.tags || [],
      stats: {
        totalRuns: 0,
        successfulRuns: 0,
        failedRuns: 0,
        avgExecutionTime: 0
      }
    });

    // Save the workflow document
    await newWorkflow.save();

    // Create trigger listeners if the workflow is being created as active
    if (args.status === 'active' && args.triggers) {
      await createTriggerListeners(workspaceId, workflowId, args.triggers);
    }

    // Disconnect from the database
    await workspaceConnection.close();

    // Return the newly created workflow
    return {
      id: newWorkflow.id,
      workspaceId: newWorkflow.workspaceId,
      name: newWorkflow.name,
      description: newWorkflow.description,
      version: newWorkflow.version,
      status: newWorkflow.status,
      nodes: newWorkflow.nodes,
      edges: newWorkflow.edges,
      triggers: newWorkflow.triggers,
      settings: newWorkflow.settings,
      createdBy: newWorkflow.createdBy,
      updatedBy: newWorkflow.updatedBy,
      tags: newWorkflow.tags,
      stats: newWorkflow.stats,
      createdAt: newWorkflow.createdAt.toISOString(),
      updatedAt: newWorkflow.updatedAt.toISOString()
    };
  } catch (error) {
    console.error('Error creating workflow:', error);
    throw error;
  }
}

// Export the createWorkflow function
module.exports = { createWorkflow }; 