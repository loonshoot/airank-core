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

async function updateBrand(parent, args, { user }) {
  if (!user || !user.sub) {
    throw new Error('User not authenticated');
  }

  const { workspaceId, workspaceSlug, id, name, isOwnBrand } = args;
  const userId = user.sub;

  try {
    // Check if user has permission to update brands
    const member = await Member.findOne({
      workspaceId: workspaceId || workspaceSlug,
      userId: userId,
      permissions: "update:brands"
    });

    if (!member) {
      throw new Error('User not authorized to update brands');
    }

    // Get the workspace-specific model
    const BrandModel = Brand(workspaceId || workspaceSlug);

    // If updating to own brand, ensure no other own brand exists
    if (isOwnBrand !== undefined && isOwnBrand) {
      const existingOwnBrand = await BrandModel.findOne({
        _id: { $ne: id },
        workspaceId: workspaceId || workspaceSlug,
        isOwnBrand: true
      });

      if (existingOwnBrand) {
        throw new Error('Only one own brand is allowed per workspace');
      }
    }

    // Build update object
    const updateFields = { updatedAt: new Date() };
    if (name !== undefined) updateFields.name = name;
    if (isOwnBrand !== undefined) updateFields.isOwnBrand = isOwnBrand;

    // Update the brand
    const brand = await BrandModel.findByIdAndUpdate(
      id,
      updateFields,
      { new: true }
    );

    if (!brand) {
      throw new Error('Brand not found');
    }

    return brand;

  } catch (error) {
    console.error('Error updating brand:', error);
    throw new Error(`Failed to update brand: ${error.message}`);
  }
}

module.exports = { updateBrand }; 