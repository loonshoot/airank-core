const mongoose = require('mongoose');
const { Member } = require('../../queries/member');
const { Workflow, TriggerListener } = require('../../../common/schemas/workflow');
const { v4: uuidv4 } = require('uuid');

// Database connection helpers
async function createWorkspaceConnection(workspaceId) {
  const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
  const connection = mongoose.createConnection(dataLakeUri);
  await connection.asPromise();
  return connection;
}

async function createOutrunConnection() {
  const outrunUri = `${process.env.MONGODB_URI}/outrun?${process.env.MONGODB_PARAMS}`;
  const connection = mongoose.createConnection(outrunUri);
  await connection.asPromise();
  return connection;
}

// Function to sync trigger listeners
async function syncTriggerListeners(workspaceId, workflowId, triggers) {
  try {
    const outrunConnection = await createOutrunConnection();
    const TriggerListenerModel = outrunConnection.model('TriggerListener', TriggerListener.schema);

    // Remove existing listeners for this workflow
    await TriggerListenerModel.deleteMany({ workflowId, workspaceId });

    // Create new listeners for active triggers
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
      console.log(`Synced ${listeners.length} trigger listeners for workflow ${workflowId}`);
    }

    await outrunConnection.close();
  } catch (error) {
    console.error('Error syncing trigger listeners:', error);
    throw error;
  }
}

// Update workflow function
async function updateWorkflow(parent, args, { user }) {
  if (!user?.sub) {
    console.error('User not authenticated');
    return null;
  }

  const workspaceId = args.workspaceId;
  const workflowId = args.workflowId;

  try {
    // Check permissions
    const member = await Member.findOne({
      workspaceId: workspaceId,
      userId: user.sub,
      permissions: "mutation:updateWorkflow"
    });

    if (!member && !user.bypassMemberCheck) {
      console.error('User not authorized to update workflows');
      return null;
    }

    // Connect to workspace database
    const workspaceConnection = await createWorkspaceConnection(workspaceId);
    const WorkflowModel = workspaceConnection.model('Workflow', Workflow.schema);

    // Find the existing workflow
    const existingWorkflow = await WorkflowModel.findOne({ id: workflowId });
    if (!existingWorkflow) {
      await workspaceConnection.close();
      throw new Error('Workflow not found');
    }

    // Update workflow fields
    const updateData = {
      updatedBy: user.sub
    };

    if (args.name !== undefined) updateData.name = args.name;
    if (args.description !== undefined) updateData.description = args.description;
    if (args.nodes !== undefined) updateData.nodes = args.nodes;
    if (args.edges !== undefined) updateData.edges = args.edges;
    if (args.triggers !== undefined) updateData.triggers = args.triggers;
    if (args.settings !== undefined) updateData.settings = args.settings;
    if (args.tags !== undefined) updateData.tags = args.tags;

    // Update the workflow
    const updatedWorkflow = await WorkflowModel.findOneAndUpdate(
      { id: workflowId },
      updateData,
      { new: true }
    );

    // Sync trigger listeners if triggers were updated
    if (args.triggers !== undefined) {
      await syncTriggerListeners(workspaceId, workflowId, args.triggers);
    }

    await workspaceConnection.close();

    return {
      id: updatedWorkflow.id,
      workspaceId: updatedWorkflow.workspaceId,
      name: updatedWorkflow.name,
      description: updatedWorkflow.description,
      version: updatedWorkflow.version,
      status: updatedWorkflow.status,
      nodes: updatedWorkflow.nodes,
      edges: updatedWorkflow.edges,
      triggers: updatedWorkflow.triggers,
      settings: updatedWorkflow.settings,
      createdBy: updatedWorkflow.createdBy,
      updatedBy: updatedWorkflow.updatedBy,
      tags: updatedWorkflow.tags,
      stats: updatedWorkflow.stats,
      createdAt: updatedWorkflow.createdAt.toISOString(),
      updatedAt: updatedWorkflow.updatedAt.toISOString()
    };
  } catch (error) {
    console.error('Error updating workflow:', error);
    throw error;
  }
}

module.exports = { updateWorkflow }; 