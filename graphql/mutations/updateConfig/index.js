const { Member } = require('../../queries/member');
const mongoose = require('mongoose');

// Async function to update configs
async function updateWorkspaceConfigs(parent, { workspaceId, workspaceSlug, configs }, { user }) {
  if (!user || !(user.sub)) {
    console.error('User not authenticated');
    return null;
  }

  try {
    // Get the user's ID from available properties
    const userId = user.sub;
    
    // Find member with the user's userId and permission
    const member = await Member.findOne({ 
      workspaceId,
      userId: userId,
      permissions: "mutation:updateConfig"
    });

    if (!member) {
      console.error('User not authorized to update config');
      return null;
    }

    // Get the Config model for this workspace
    const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
    const datalake = mongoose.createConnection(dataLakeUri);

    // Define Config model without history
    const ConfigModel = datalake.model('Config', new mongoose.Schema({
      _id: { type: mongoose.Schema.Types.ObjectId, required: true },
      configType: { type: String, required: true },
      data: { type: mongoose.Schema.Types.Mixed, required: true },
      method: { type: String, enum: ['automatic', 'manual'], default: 'automatic' },
      updatedAt: { type: Date, default: Date.now }
    }));

    // Define ConfigHistory model
    const ConfigHistoryModel = datalake.model('ConfigHistory', new mongoose.Schema({
      configId: { type: mongoose.Schema.Types.ObjectId, required: true },
      configType: { type: String, required: true },
      member: { type: String, required: true },
      data: { type: mongoose.Schema.Types.Mixed, required: true },
      method: { type: String, enum: ['automatic', 'manual'], required: true },
      timestamp: { type: Date, default: Date.now }
    }, { collection: 'configHistory' }));

    const updatedConfigs = [];

    // Update each config document
    for (const config of configs) {
      const now = new Date();
      let method = config.data.method || 'automatic';

      // Get previous config to check for changes
      const previousConfig = await ConfigModel.findOne({ configType: config.configType });

      // Update or create config
      const updatedConfig = await ConfigModel.findOneAndUpdate(
        { configType: config.configType },
        {
          $set: {
            data: config.data,
            method,
            updatedAt: now
          }
        },
        {
          new: true,
          upsert: true // Create if doesn't exist
        }
      );

      // Create history entry
      await ConfigHistoryModel.create({
        configId: updatedConfig._id,
        configType: config.configType,
        member: member._id.toString(),
        data: config.data,
        method,
        timestamp: now
      });

      // Special handling for billing config changes
      if (config.configType === 'billing') {
        const wasAdvanced = previousConfig?.data?.advancedBilling === true;
        const isAdvanced = config.data.advancedBilling === true;

        // If switching from advanced to simple billing, revert to default billing profile
        if (wasAdvanced && !isAdvanced) {
          const airankUri = `${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`;
          const airankDb = mongoose.createConnection(airankUri);
          await airankDb.asPromise();

          const workspacesCollection = airankDb.collection('workspaces');
          const workspace = await workspacesCollection.findOne({ _id: workspaceId });

          if (workspace && workspace.defaultBillingProfileId) {
            await workspacesCollection.updateOne(
              { _id: workspaceId },
              {
                $set: {
                  billingProfileId: workspace.defaultBillingProfileId,
                  updatedAt: new Date()
                }
              }
            );
          }

          await airankDb.close();
        }
      }

      updatedConfigs.push(updatedConfig);
    }

    return updatedConfigs;
  } catch (error) {
    console.error('Error updating workspace configs:', error);
    throw error;
  }
}

module.exports = { updateWorkspaceConfigs }; 