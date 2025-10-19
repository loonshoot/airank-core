const mongoose = require('mongoose');
const { Member } = require('../../queries/member');
const { enforceCharacterLimit, getEntitlements } = require('../helpers/entitlements');

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

async function updatePrompt(parent, args, { user }) {
  if (!user || !user.sub) {
    throw new Error('User not authenticated');
  }

  const { workspaceId, workspaceSlug, id, phrase } = args;
  const userId = user.sub;

  try {
    // Check if user has permission to update prompts
    const member = await Member.findOne({
      workspaceId: workspaceId || workspaceSlug,
      userId: userId,
      permissions: "update:prompts"
    });

    if (!member) {
      throw new Error('User not authorized to update prompts');
    }

    // Enforce character limit on the phrase
    const entitlements = await getEntitlements(workspaceId || workspaceSlug);
    const enforcedPhrase = enforceCharacterLimit(phrase, entitlements.promptCharacterLimit);

    if (enforcedPhrase.isTruncated) {
      console.warn(`Prompt truncated from ${enforcedPhrase.originalLength} to ${enforcedPhrase.limit} characters`);
    }

    // Get the workspace-specific model
    const PromptModel = Prompt(workspaceId || workspaceSlug);

    // Update the prompt with enforced character limit
    const prompt = await PromptModel.findByIdAndUpdate(
      id,
      { phrase: enforcedPhrase.truncated, updatedAt: new Date() },
      { new: true }
    );

    if (!prompt) {
      throw new Error('Prompt not found');
    }

    return prompt;

  } catch (error) {
    console.error('Error updating prompt:', error);
    throw new Error(`Failed to update prompt: ${error.message}`);
  }
}

module.exports = { updatePrompt };
 