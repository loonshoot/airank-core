const mongoose = require('mongoose');
const { Member } = require('../../queries/member');

// Define the Brand Model factory for workspace-specific connections
const Brand = (workspaceId) => {
  const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
  const datalake = mongoose.createConnection(dataLakeUri);

  return datalake.model('Brand', new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    isOwnBrand: { type: Boolean, required: true, default: false },
    workspaceId: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  }));
};

async function deleteBrand(parent, args, { user }) {
  if (!user || !user.sub) {
    throw new Error('User not authenticated');
  }

  const { workspaceId, workspaceSlug, id } = args;
  const userId = user.sub;

  try {
    // Check if user has permission to delete brands
    const member = await Member.findOne({
      workspaceId: workspaceId || workspaceSlug,
      userId: userId,
      permissions: "delete:brands"
    });

    if (!member) {
      throw new Error('User not authorized to delete brands');
    }

    // Get the workspace-specific model
    const BrandModel = Brand(workspaceId || workspaceSlug);

    // Delete the brand
    const deletedBrand = await BrandModel.findByIdAndDelete(id);

    if (!deletedBrand) {
      throw new Error('Brand not found');
    }

    // Get remaining brands
    const remainingBrands = await BrandModel.find({ workspaceId: workspaceId || workspaceSlug });

    return {
      message: 'Brand deleted successfully',
      remainingBrands
    };

  } catch (error) {
    console.error('Error deleting brand:', error);
    throw new Error(`Failed to delete brand: ${error.message}`);
  }
}

module.exports = { deleteBrand };