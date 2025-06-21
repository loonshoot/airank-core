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

async function createBrand(parent, args, { user }) {
  if (!user || !user.sub) {
    throw new Error('User not authenticated');
  }

  const { workspaceId, workspaceSlug, name, isOwnBrand = false } = args;
  const userId = user.sub;

  try {
    // Check if user has permission to create brands
    const member = await Member.findOne({
      workspaceId: workspaceId || workspaceSlug,
      userId: userId,
      permissions: "create:brands"
    });

    if (!member) {
      throw new Error('User not authorized to create brands');
    }

    // Get the workspace-specific model
    const BrandModel = Brand(workspaceId || workspaceSlug);

    // If this is meant to be the own brand, check if one already exists
    if (isOwnBrand) {
      const existingOwnBrand = await BrandModel.findOne({
        workspaceId: workspaceId || workspaceSlug,
        isOwnBrand: true
      });

      if (existingOwnBrand) {
        throw new Error('Only one own brand is allowed per workspace');
      }
    }

    // Create the brand
    const brand = new BrandModel({
      _id: new mongoose.Types.ObjectId(),
      name,
      isOwnBrand,
      workspaceId: workspaceId || workspaceSlug
    });

    await brand.save();
    return brand;

  } catch (error) {
    console.error('Error creating brand:', error);
    throw new Error(`Failed to create brand: ${error.message}`);
  }
}

module.exports = { createBrand }; 