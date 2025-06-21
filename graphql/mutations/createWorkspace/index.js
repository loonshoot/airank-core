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
      "mutation:createApiKey"

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