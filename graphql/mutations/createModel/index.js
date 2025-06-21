const mongoose = require('mongoose');
const { Member } = require('../../queries/member');

// Define the Model factory for workspace-specific connections
const Model = (workspaceId) => {
  const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
  const datalake = mongoose.createConnection(dataLakeUri);

  return datalake.model('Model', new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    provider: { type: String, required: true },
    modelId: { type: String, required: true },
    isEnabled: { type: Boolean, required: true, default: true },
    workspaceId: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  }));
};

async function createModel(parent, args, { user }) {
  if (!user || !user.sub) {
    throw new Error('User not authenticated');
  }

  const { workspaceId, workspaceSlug, name, provider, modelId, isEnabled = true } = args;
  const userId = user.sub;

  try {
    // Check if user has permission to create models
    const member = await Member.findOne({
      workspaceId: workspaceId || workspaceSlug,
      userId: userId,
      permissions: "create:models"
    });

    if (!member) {
      throw new Error('User not authorized to create models');
    }

    // Get the workspace-specific model
    const ModelModel = Model(workspaceId || workspaceSlug);

    // Check if model with same provider and modelId already exists
    const existingModel = await ModelModel.findOne({
      workspaceId: workspaceId || workspaceSlug,
      provider,
      modelId
    });

    if (existingModel) {
      throw new Error('Model with this provider and modelId already exists');
    }

    // Create the model
    const model = new ModelModel({
      _id: new mongoose.Types.ObjectId(),
      name,
      provider,
      modelId,
      isEnabled,
      workspaceId: workspaceId || workspaceSlug
    });

    await model.save();
    return model;

  } catch (error) {
    console.error('Error creating model:', error);
    throw new Error(`Failed to create model: ${error.message}`);
  }
}

module.exports = { createModel }; 