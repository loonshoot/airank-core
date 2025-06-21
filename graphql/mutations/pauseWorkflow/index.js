const mongoose = require('mongoose');
const { Member } = require('../../queries/member');
const { Workflow, TriggerListener } = require('../../../common/schemas/workflow');

async function pauseWorkflow(parent, args, { user }) {
  if (!user?.sub) return null;

  const workspaceId = args.workspaceId;
  const workflowId = args.workflowId;

  try {
    const member = await Member.findOne({
      workspaceId,
      userId: user.sub,
      permissions: "mutation:pauseWorkflow"
    });

    if (!member && !user.bypassMemberCheck) return null;

    const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
    const workspaceConnection = mongoose.createConnection(dataLakeUri);
    await workspaceConnection.asPromise();

    const WorkflowModel = workspaceConnection.model('Workflow', Workflow.schema);
    const workflow = await WorkflowModel.findOneAndUpdate(
      { id: workflowId },
      { status: 'paused', updatedBy: user.sub },
      { new: true }
    );

    const airankUri = `${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`;
    const airankConnection = mongoose.createConnection(airankUri);
    await airankConnection.asPromise();

    const TriggerListenerModel = airankConnection.model('TriggerListener', TriggerListener.schema);
    await TriggerListenerModel.updateMany(
      { workflowId, workspaceId },
      { active: false }
    );

    await Promise.all([workspaceConnection.close(), airankConnection.close()]);
    return workflow;
  } catch (error) {
    console.error('Error pausing workflow:', error);
    throw error;
  }
}

module.exports = { pauseWorkflow }; 