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

async function deleteModel(parent, args, { user }) {
  if (!user || !user.sub) {
    throw new Error('User not authenticated');
  }

  const { workspaceId, workspaceSlug, id } = args;
  const userId = user.sub;

  try {
    // Check if user has permission to delete models
    const member = await Member.findOne({
      workspaceId: workspaceId || workspaceSlug,
      userId: userId,
      permissions: "delete:models"
    });

    if (!member) {
      throw new Error('User not authorized to delete models');
    }

    // Get the workspace-specific model
    const ModelModel = Model(workspaceId || workspaceSlug);

    // Delete the model
    const deletedModel = await ModelModel.findByIdAndDelete(id);

    if (!deletedModel) {
      throw new Error('Model not found');
    }

    // Get remaining models
    const remainingModels = await ModelModel.find({ workspaceId: workspaceId || workspaceSlug });

    return {
      message: 'Model deleted successfully',
      remainingModels
    };

  } catch (error) {
    console.error('Error deleting model:', error);
    throw new Error(`Failed to delete model: ${error.message}`);
  }
}

module.exports = { deleteModel }; 