const mongoose = require('mongoose');
const slugify = require('slugify');
const crypto = require('crypto');

/**
 * Create a new workspace for a user
 * This is an open endpoint that doesn't require workspace permissions
 */
async function createWorkspace(parent, args, { user }) {
  if (!user || !user.email) {
    throw new Error('Authentication required');
  }

  try {
    // Connect to the airank database
    const airankUri = `${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`;
    const airankDb = mongoose.createConnection(airankUri);
    await airankDb.asPromise();

    // Generate unique IDs using Mongoose ObjectId
    const workspaceId = new mongoose.Types.ObjectId().toString();
    
    // Generate random codes for workspaceCode and inviteCode
    const workspaceCode = crypto.randomBytes(12).toString('hex');
    const inviteCode = crypto.randomBytes(12).toString('hex');
    
    // Create a slug from the name (lowercase, replace spaces with hyphens)
    const name = args.name.trim();
    let slug = slugify(name, { lower: true, strict: true });
    
    // Check if slug already exists and make it unique if needed
    const workspaceCollection = airankDb.collection('workspaces');
    const existingWorkspace = await workspaceCollection.findOne({ slug });
    if (existingWorkspace) {
      // Append a random string to make the slug unique
      const randomSuffix = crypto.randomBytes(3).toString('hex');
      slug = `${slug}-${randomSuffix}`;
    }

    // Create workspace document
    const workspace = {
      _id: workspaceId,
      workspaceCode,
      inviteCode,
      creatorId: user.sub || user._id,
      chargebeeSubscriptionId: args.chargebeeSubscriptionId || "freeTier",
      chargebeeCustomerId: args.chargebeeCustomerId || "freeTier",
      name,
      slug,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Insert workspace into the workspaces collection
    await workspaceCollection.insertOne(workspace);

    // All permissions for the owner
    const allPermissions = [
      "query:members",
      "query:sources",
      "query:workspaces",
      "query:integrations",
      "query:jobs",
      "query:tokens",
      "query:collections",
      "query:objects",
      "query:logs",
      "query:config",
      "query:streamRoutes",
      "query:query",
      "query:facts",
      "query:destinations",
      "query:analytics",
      "query:prompts",
      "query:brands",
      "query:models",
      "query:rankings",
      "query:reports",
      "create:prompts",
      "create:brands",
      "create:models",
      "update:prompts",
      "update:brands",
      "update:models",
      "delete:prompts",
      "delete:brands",
      "delete:models",
      "mutation:updateConfig",
      "mutation:registerExternalCredentials",
      "mutation:archiveSource",
      "mutation:createSource",
      "mutation:deleteExternalCredentials",
      "mutation:deleteSource",
      "mutation:scheduleJobs",
      "mutation:updateSource",
      "mutation:createStreamRoute",
      "mutation:createQuery",
      "mutation:updateQuery",
      "mutation:deleteQuery",
      "mutation:runQuery",
      "mutation:createDestination",
      "mutation:archiveDestination",
      "mutation:updateDestination",
      "mutation:deleteDestination",
      "mutation:createApiKey",
      // Member management permissions
      "mutation:createMember",
      "mutation:updateMember",
      "mutation:deleteMember"
    ];

    // Create member document for the workspace owner
    const member = {
      _id: new mongoose.Types.ObjectId().toString(), // Generate ID using mongoose
      workspaceId,
      userId: user.sub || user._id, // Add userId field
      inviter: user.sub || user._id, // Use user ID for inviter instead of email
      permissions: allPermissions,
      invitedAt: new Date(),
      updatedAt: new Date(),
      status: "ACCEPTED",
      teamRole: "OWNER"
    };

    // Insert member into the members collection
    const membersCollection = airankDb.collection('members');
    await membersCollection.insertOne(member);

    // Auto-create billing profile for the workspace
    const billingProfileId = new mongoose.Types.ObjectId().toString();
    const billingProfile = {
      _id: billingProfileId,
      name: `${name} Billing`,
      currentPlan: 'free',
      brandsLimit: 1,
      brandsUsed: 0,
      promptsLimit: 4,
      promptsUsed: 0,
      promptCharacterLimit: 150,
      promptsResetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      modelsLimit: 1,
      allowedModels: ['gpt-4o-mini-2024-07-18'],  // Free tier allowed models
      jobFrequency: 'monthly',
      dataRetentionDays: 30,
      hasPaymentMethod: false,
      isDefault: true,  // This is a workspace default profile
      defaultForWorkspaceId: workspaceId,  // Link to the workspace
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Insert billing profile
    const billingProfilesCollection = airankDb.collection('billingprofiles');
    await billingProfilesCollection.insertOne(billingProfile);

    // Add user as billing profile manager with full permissions
    const billingProfileMember = {
      _id: new mongoose.Types.ObjectId().toString(),
      billingProfileId,
      userId: user.sub || user._id,
      role: 'manager',
      permissions: {
        attach: true,  // Can attach to workspaces (though default profiles can't be shared)
        modify: true,  // Can modify settings and members
        delete: true   // Can delete (though default profiles can't be deleted)
      },
      addedBy: user.sub || user._id, // Creator added themselves
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const billingProfileMembersCollection = airankDb.collection('billingprofilemembers');
    await billingProfileMembersCollection.insertOne(billingProfileMember);

    // Link workspace to billing profile and set as default
    workspace.billingProfileId = billingProfileId;
    workspace.defaultBillingProfileId = billingProfileId;
    workspace.config = { advancedBilling: false };
    await workspaceCollection.updateOne(
      { _id: workspaceId },
      {
        $set: {
          billingProfileId,
          defaultBillingProfileId: billingProfileId,
          config: { advancedBilling: false }
        }
      }
    );

    // Create the workspace database
    const workspaceDbUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
    const workspaceDb = mongoose.createConnection(workspaceDbUri);
    await workspaceDb.asPromise();

    // Create initial collections in the workspace database
    await Promise.all([
      workspaceDb.createCollection('sources'),
      workspaceDb.createCollection('jobs'),
      workspaceDb.createCollection('people'),
      workspaceDb.createCollection('organizations'),
      workspaceDb.createCollection('relationships'),
      workspaceDb.createCollection('logs'),
      workspaceDb.createCollection('configs')
    ]).catch(err => {
      // Ignore collection exists error
      if (err.code !== 48) throw err;
    });

    // Create initial billing config in workspace database
    const configsCollection = workspaceDb.collection('configs');
    await configsCollection.insertMany([
      {
        _id: new mongoose.Types.ObjectId(),
        configType: 'billing',
        data: { advancedBilling: false },
        method: 'automatic',
        updatedAt: new Date()
      },
      {
        _id: new mongoose.Types.ObjectId(),
        configType: 'setup',
        data: { inSetupMode: true },
        method: 'automatic',
        updatedAt: new Date()
      }
    ]);

    // Close connections
    await Promise.all([
      airankDb.close(),
      workspaceDb.close()
    ]);

    // Return the created workspace
    return workspace;
  } catch (error) {
    console.error('Error creating workspace:', error);
    throw error;
  }
}

// Export the createWorkspace function
module.exports = { createWorkspace }; 