// airank-core/graphql/queries/job.js
const { gql } = require('apollo-server-express');
const mongoose = require('mongoose');
const { ObjectId } = mongoose.Types;
const { Member } = require('../member');

// Define the Job Schema (with explicit collection name)
const jobSchema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId, required: true },
  name: { type: String },
  data: { type: mongoose.Schema.Types.Mixed },
  priority: { type: Number },
  type: { type: String },
  nextRunAt: { type: String },
  lastModifiedBy: { type: String },
  lockedAt: { type: String },
  lastRunAt: { type: String },
  lastFinishedAt: { type: String },
  status: { type: String }, // Add status field
  failReason: { type: String },
  failedAt: { type: String }
}, { collection: 'jobs' });

// Define the Job Model
const Job = mongoose.model('Job', jobSchema); // Use a consistent model name

// Define the Job Schema (with explicit collection name)
const jobHistorySchema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId, required: true },
  status: { type: String },
  sourceId: { type: String },
  startTime: { type: Date },
  endTime: { type: Date },
  errors: [{ type: mongoose.Schema.Types.Mixed }],
  apiCalls: { type: Number },
  ingressBytes: { type: Number },
  runtimeMilliseconds: { type: Number }
}, { collection: 'jobHistory' });

// Define the Job Model
const JobHistory = mongoose.model('JobHistory', jobHistorySchema); // Use a consistent model name

// Define the typeDefs (schema)
const typeDefs = gql`
  type Job {
    _id: ID!
    name: String
    data: JSON!
    priority: Int
    type: String
    nextRunAt: String
    lastModifiedBy: String
    lockedAt: String
    lastRunAt: String
    lastFinishedAt: String
    status: String
    failReason: String
    failedAt: String
    startTime: String
    endTime: String
    errors: [JSON]
    apiCalls: Int
    ingressBytes: Int
    runtimeMilliseconds: Int
  }

  type Query {
    jobs(workspaceId: String, jobId: String, sourceId: String, destinationId: ID): [Job]!
  }
`;

// Define the resolvers
const resolvers = {
  jobs: async (_, { workspaceId, jobId, sourceId, destinationId }, { user }) => {
    if (user && (user.sub)) {
      const member = await Member.findOne({ workspaceId, userId: user.sub,
        permissions: "query:jobs"
      });

      if (member) {
        if (jobId) {
          // Use async/await to handle the promise properly
          let job = await Job.findOne({ _id: jobId, 'data.workspaceId': workspaceId });
          console.log(job)
          if (!job) { // Query the data lake if not found in the main database
            const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
            console.log("Data Lake URI:", dataLakeUri);

            let dataLakeConnection;
            try {
              dataLakeConnection = await mongoose.createConnection(dataLakeUri);
              const HistoricJob = dataLakeConnection.model('JobHistory', JobHistory.schema);
              const historicJob = await HistoricJob.findOne({ _id: jobId });
              console.log("Data Lake Database Name:", dataLakeConnection.db.databaseName);
              console.log("Data Lake Collection Name:", HistoricJob.collection.collectionName);
              if (historicJob) {
                job = historicJob;
                // Explicitly add missing fields and provide defaults if needed
                // job.name = historicJob.name || null;
                // job.priority = historicJob.priority || null;
                // job.type = historicJob.type || null;
                // ... add other fields from Job schema with default values
              } 
            } catch (error) {
              console.error("Error querying data lake:", error);
            } finally {
              if (dataLakeConnection) {
                dataLakeConnection.close();
              }
            }
          }

          if (job && Object.keys(job.data || {}).length === 0) {
            throw new Error(`Job with ID ${jobId} is misconfigured: Data is empty.`);
          }

          // Only set the status if it's not already present
          if (!job.status) {
            job.status = job?.nextRunAt ? 'scheduled' : 'archived';
          }

          // Convert _id to string before returning
          return job ? [ job ] : []; 

        } else {
          let query = { 'data.workspaceId': workspaceId, nextRunAt: { $nin: [null, "", undefined] } };
          if (sourceId) {
            query['data.sourceId'] = sourceId;
          }
          if (destinationId) {
            query['data.destinationId'] = destinationId;
          }
          const jobs = await Job.find(query).sort({ nextRunAt: -1 });
          console.log("Jobs:", jobs);
          const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
          const dataLakeConnection = await mongoose.createConnection(dataLakeUri);
          const HistoricJob = dataLakeConnection.model('jobHistory', JobHistory.schema);

          let historicJobsQuery = {};
          if (sourceId) {
            historicJobsQuery['sourceId'] = sourceId;
          }
          if (destinationId) {
            historicJobsQuery['destinationId'] = destinationId;
          }
          const historicJobs = await HistoricJob.find(historicJobsQuery).sort({ startTime: -1 }).lean();
          console.log("Historic jobs:", historicJobs);
          dataLakeConnection.close();

          const allJobs = [
            ...jobs.map(j => {
              const obj = j.toObject();
              // Convert all date fields to ISO format, handle undefined values
              if (obj.nextRunAt) {
                try {
                  obj.nextRunAt = new Date(obj.nextRunAt).toISOString();
                } catch (e) {
                  obj.nextRunAt = null;
                }
              }
              if (obj.lastRunAt) {
                try {
                  obj.lastRunAt = new Date(obj.lastRunAt).toISOString();
                } catch (e) {
                  obj.lastRunAt = null;
                }
              }
              if (obj.lastFinishedAt) {
                try {
                  obj.lastFinishedAt = new Date(obj.lastFinishedAt).toISOString();
                } catch (e) {
                  obj.lastFinishedAt = null;
                }
              }
              return obj;
            }), 
            ...historicJobs.map(hj => ({
              _id: hj._id,
              status: hj.status,
              data: { sourceId: hj.sourceId, workspaceId: workspaceId },
              lastRunAt: hj.startTime ? new Date(hj.startTime).toISOString() : null,
              lastFinishedAt: hj.endTime ? new Date(hj.endTime).toISOString() : null,
              startTime: hj.startTime ? new Date(hj.startTime).toISOString() : null,
              endTime: hj.endTime ? new Date(hj.endTime).toISOString() : null,
              errors: hj.errors || [],
              apiCalls: hj.apiCalls || 0,
              ingressBytes: hj.ingressBytes || 0,
              runtimeMilliseconds: hj.runtimeMilliseconds || 0
            }))
          ].sort((a, b) => {
            const aDate = a.nextRunAt || a.lastRunAt || a.startTime;
            const bDate = b.nextRunAt || b.lastRunAt || b.startTime;
            return new Date(bDate) - new Date(aDate); // Descending order (newest first)
          });

          allJobs.forEach((job, index) => {
            if (job && Object.keys(job.data || {}).length === 0) {
              throw new Error(`Job at index ${index} in workspace ${workspaceId} is misconfigured: Data is empty.`);
            }
          });

          const processedJobs = allJobs.map(job => {
            // Only set the status if it's not already present
            if (!job.status) {
              job.status = job?.nextRunAt ? 'scheduled' : 'archived';
            }
            return { ...job };
          });

          return processedJobs;
        }
      } else {
        console.error('User not authorized to query jobs');
        return []; // Return empty array for consistency
      }
    } else {
      console.error('User not authenticated or userId not found');
      return []; // Return empty array for consistency
    }
  }
};


module.exports = { typeDefs, resolvers, Job };