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

async function updateModel(parent, args, { user }) {
  if (!user || !user.sub) {
    throw new Error('User not authenticated');
  }

  const { workspaceId, workspaceSlug, id, name, provider, modelId, isEnabled } = args;
  const userId = user.sub;

  try {
    // Check if user has permission to update models
    const member = await Member.findOne({
      workspaceId: workspaceId || workspaceSlug,
      userId: userId,
      permissions: "update:models"
    });

    if (!member) {
      throw new Error('User not authorized to update models');
    }

    // Get the workspace-specific model
    const ModelModel = Model(workspaceId || workspaceSlug);

    // If updating provider/modelId, check for duplicates
    if (provider !== undefined && modelId !== undefined) {
      const existingModel = await ModelModel.findOne({
        _id: { $ne: id },
        workspaceId: workspaceId || workspaceSlug,
        provider,
        modelId
      });

      if (existingModel) {
        throw new Error('Model with this provider and modelId already exists');
      }
    }

    // Build update object
    const updateFields = { updatedAt: new Date() };
    if (name !== undefined) updateFields.name = name;
    if (provider !== undefined) updateFields.provider = provider;
    if (modelId !== undefined) updateFields.modelId = modelId;
    if (isEnabled !== undefined) updateFields.isEnabled = isEnabled;

    // Update the model
    const model = await ModelModel.findByIdAndUpdate(
      id,
      updateFields,
      { new: true }
    );

    if (!model) {
      throw new Error('Model not found');
    }

    return model;

  } catch (error) {
    console.error('Error updating model:', error);
    throw new Error(`Failed to update model: ${error.message}`);
  }
}

module.exports = { updateModel }; 