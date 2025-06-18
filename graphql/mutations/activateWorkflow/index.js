const mongoose = require('mongoose');
const { Member } = require('../../queries/member');
const { Workflow, TriggerListener } = require('../../../common/schemas/workflow');
const { v4: uuidv4 } = require('uuid');

async function activateWorkflow(parent, args, { user }) {
  if (!user?.sub) {
    return null;
  }

  const workspaceId = args.workspaceId;
  const workflowId = args.workflowId;

  try {
    const member = await Member.findOne({
      workspaceId,
      userId: user.sub,
      permissions: "mutation:activateWorkflow"
    });

    if (!member && !user.bypassMemberCheck) {
      return null;
    }

    const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
    const workspaceConnection = mongoose.createConnection(dataLakeUri);
    await workspaceConnection.asPromise();

    const WorkflowModel = workspaceConnection.model('Workflow', Workflow.schema);
    const workflow = await WorkflowModel.findOneAndUpdate(
      { id: workflowId },
      { status: 'active', updatedBy: user.sub },
      { new: true }
    );

    await workspaceConnection.close();
    return workflow;
  } catch (error) {
    console.error('Error activating workflow:', error);
    throw error;
  }
}

module.exports = { activateWorkflow }; 