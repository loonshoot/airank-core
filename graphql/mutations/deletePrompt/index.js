const mongoose = require('mongoose');
const { Member } = require('../../queries/member');

// Define the Prompt Model factory for workspace-specific connections
const Prompt = (workspaceId) => {
  const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
  const datalake = mongoose.createConnection(dataLakeUri);

  return datalake.model('Prompt', new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, required: true },
    phrase: { type: String, required: true },
    workspaceId: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  }));
};

async function deletePrompt(parent, args, { user }) {
  if (!user || !user.sub) {
    throw new Error('User not authenticated');
  }

  const { workspaceId, workspaceSlug, id } = args;
  const userId = user.sub;

  try {
    // Check if user has permission to delete prompts
    const member = await Member.findOne({
      workspaceId: workspaceId || workspaceSlug,
      userId: userId,
      permissions: "delete:prompts"
    });

    if (!member) {
      throw new Error('User not authorized to delete prompts');
    }

    // Get the workspace-specific model
    const PromptModel = Prompt(workspaceId || workspaceSlug);

    // Delete the prompt
    const deletedPrompt = await PromptModel.findByIdAndDelete(id);

    if (!deletedPrompt) {
      throw new Error('Prompt not found');
    }

    // Get remaining prompts
    const remainingPrompts = await PromptModel.find({ workspaceId: workspaceId || workspaceSlug });

    return {
      message: 'Prompt deleted successfully',
      remainingPrompts
    };

  } catch (error) {
    console.error('Error deleting prompt:', error);
    throw new Error(`Failed to delete prompt: ${error.message}`);
  }
}

module.exports = { deletePrompt };