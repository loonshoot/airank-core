// mutations/archiveSource/index.js
const { Member } = require('../../queries/member');
const mongoose = require('mongoose');
const { Job } = require('../../queries/job');

// Define the source schema
const sourceSchema = new mongoose.Schema({
  name: String,
  sourceType: String,
  status: String
});

// Function to deactivate source listeners
async function removeSourceListeners(workspaceId, sourceId) {
    try {
        const airankUri = `${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`;
        const workspaceUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
        
        const [airankDb, workspaceDb] = await Promise.all([
            mongoose.createConnection(airankUri).asPromise(),
            mongoose.createConnection(workspaceUri).asPromise()
        ]);

        const listenersCollection = airankDb.collection('listeners');
        const archivedListenersCollection = workspaceDb.collection('archivedListeners');
        
        // Find all listeners for this source
        const listeners = await listenersCollection.find({ 'metadata.sourceId': sourceId }).toArray();
        
        if (listeners.length > 0) {
            // Add archived timestamp to each listener
            const listenersToArchive = listeners.map(listener => ({
                ...listener,
                archivedAt: new Date()
            }));
            
            // Copy listeners to archived collection
            await archivedListenersCollection.insertMany(listenersToArchive);
            
            // Delete all listeners associated with this source
            const result = await listenersCollection.deleteMany({ 'metadata.sourceId': sourceId });
            
            console.log(`Archived and deleted ${result.deletedCount} listeners for source ${sourceId}`);
            
            await Promise.all([airankDb.close(), workspaceDb.close()]);
            return result.deletedCount;
        }

        await Promise.all([airankDb.close(), workspaceDb.close()]);
        return 0;
    } catch (err) {
        console.error('Error removing source listeners:', err);
        throw err;
    }
}

// Async function to establish the database connection
async function createConnection(workspaceId) {
  const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
  try {
    const datalake = mongoose.createConnection(dataLakeUri);
    datalake.model('Source', sourceSchema); 
    await datalake.asPromise();
    return datalake;
  } catch (error) {
    console.error('Error connecting to workspace database:', error);
    throw error; 
  }
}

// Async function to delete a source
async function archiveSource(parent, args, { user }) {
  if (user && (user.sub)) {
    const member = await Member.findOne({
      workspaceId: args.workspaceId,
      email: user.email,
      permissions: "mutation:archiveSource",
    });

    if (member) {
      try {
        if (!args.id) {
          throw new Error('Missing required field: _id');
        }

        const datalake = await createConnection(args.workspaceId);
        const workspaceSourceModel = datalake.model('Source');
        const objectId = new mongoose.Types.ObjectId(args.id);

        // Archive the source
        const archivedSource = await workspaceSourceModel.findOneAndUpdate({
          _id: objectId,
        }, 
        { 
          status: "archived"
        });

        if (archivedSource) {
          // Remove associated listeners
          await removeSourceListeners(args.workspaceId, args.id);

          // Debug: Log the search criteria
          console.log('Attempting to delete jobs with criteria:', {
            sourceId: args.id,
            workspaceId: args.workspaceId
          });

          // Debug: Find jobs before deletion
          const jobsToDelete = await Job.find({
            'data.sourceId': args.id,
            'data.workspaceId': args.workspaceId
          });

          // Perform the deletion
          const deleteResult = await Job.deleteMany({
            'data.sourceId': args.id,
            'data.workspaceId': args.workspaceId
          });

          // Debug: Log deletion result
          console.log('Delete operation result:', deleteResult);

          const remainingSources = await workspaceSourceModel.find();
          await datalake.close();

          return {
            message: `Source archived successfully. Deleted ${deleteResult.deletedCount} jobs.`,
            remainingSources: remainingSources.map((source) => ({
              _id: source._id,
              name: source.name,
              sourceType: source.sourceType,
              status: source.status
            })),
          };
        } else {
          return null;
        }

      } catch (error) {
        console.error('Error archiving source:', error);
        throw error;
      }
    } else {
      console.error('User not authorized to archive sources');
      return null;
    }
  }
  console.error('User not authenticated or userId not found');
  return null;
}

// Export the archiveSource function
module.exports = { archiveSource };