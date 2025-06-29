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

async function createPrompt(parent, args, { user }) {
  if (!user || !user.sub) {
    throw new Error('User not authenticated');
  }

  const { workspaceId, workspaceSlug, phrase } = args;
  const userId = user.sub;

  try {
    // Check if user has permission to create prompts
    const member = await Member.findOne({
      workspaceId: workspaceId || workspaceSlug,
      userId: userId,
      permissions: "create:prompts"
    });

    if (!member) {
      throw new Error('User not authorized to create prompts');
    }

    // Get the workspace-specific model
    const PromptModel = Prompt(workspaceId || workspaceSlug);

    // Create the prompt
    const prompt = new PromptModel({
      _id: new mongoose.Types.ObjectId(),
      phrase,
      workspaceId: workspaceId || workspaceSlug
    });

    await prompt.save();
    return prompt;

  } catch (error) {
    console.error('Error creating prompt:', error);
    throw new Error(`Failed to create prompt: ${error.message}`);
  }
}

module.exports = { createPrompt };
 