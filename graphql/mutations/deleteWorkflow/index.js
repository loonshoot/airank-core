const mongoose = require('mongoose');
const { Member } = require('../../queries/member');
const { Workflow, WorkflowRun, TriggerListener } = require('../../../common/schemas/workflow');

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

async function deleteWorkflow(parent, args, { user }) {
  if (!user?.sub) {
    console.error('User not authenticated');
    return false;
  }

  const workspaceId = args.workspaceId;
  const workflowId = args.workflowId;

  try {
    const member = await Member.findOne({
      workspaceId: workspaceId,
      userId: user.sub,
      permissions: "mutation:deleteWorkflow"
    });

    if (!member && !user.bypassMemberCheck) {
      console.error('User not authorized to delete workflows');
      return false;
    }

    const workspaceConnection = await createWorkspaceConnection(workspaceId);
    const WorkflowModel = workspaceConnection.model('Workflow', Workflow.schema);
    const WorkflowRunModel = workspaceConnection.model('WorkflowRun', WorkflowRun.schema);

    const existingWorkflow = await WorkflowModel.findOne({ id: workflowId });
    if (!existingWorkflow) {
      await workspaceConnection.close();
      throw new Error('Workflow not found');
    }

    const airankConnection = await createAIRankConnection();
    const TriggerListenerModel = airankConnection.model('TriggerListener', TriggerListener.schema);

    await TriggerListenerModel.deleteMany({ workflowId, workspaceId });
    await WorkflowRunModel.deleteMany({ workflowId, workspaceId });
    await WorkflowModel.deleteOne({ id: workflowId });

    await Promise.all([workspaceConnection.close(), airankConnection.close()]);
    return true;
  } catch (error) {
    console.error('Error deleting workflow:', error);
    throw error;
  }
}

module.exports = { deleteWorkflow }; 