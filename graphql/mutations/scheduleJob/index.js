const Agenda = require('agenda');
require('dotenv').config();
const { Member } = require('../../queries/member');

// Async function to schedule a job with Agenda
async function scheduleJobMutation(parent, args, { user }) {
  if (user && (user.sub)) {
    const member = await Member.findOne({
      workspaceId: args.workspaceId,
      userId: user.sub,
      permissions: "mutation:scheduleJobs"
    });
    if (member) {
      return new Promise((resolve, reject) => {
        const mongoUri = `${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`;
        const scheduledJobs = [];

        const agenda = new Agenda({ db: { address: mongoUri, collection: 'jobs' } });

        agenda.on('ready', async () => {
          try {
            if (Array.isArray(args.jobs)) {
              for (const jobArgs of args.jobs) {
                if (!jobArgs.name) {
                  throw new Error('Missing required fields: name');
                }

                jobArgs.data.workspaceId = args.workspaceId;

                let job;
                if (jobArgs.schedule && jobArgs.schedule.toLowerCase() === 'now') {
                  job = await agenda.now(jobArgs.name, jobArgs.data);
                  await job.save(); // Save the job after setting repeatEvery
                } else if (jobArgs.schedule) {
                  job = await agenda.schedule(jobArgs.schedule, jobArgs.name, jobArgs.data);
                  await job.save(); // Save the job after setting repeatEvery
                } else if (jobArgs.repeatEvery) {
                  job = await agenda.create(jobArgs.name, jobArgs.data);
                  await job.repeatEvery(jobArgs.repeatEvery, { 
                    skipImmediate: jobArgs.skipImmediate || false 
                  }); 
                  await job.save(); // Save the job after setting repeatEvery
                } else {
                  throw new Error('Missing required fields: schedule or repeatEvery');
                }

                await applyOptionalSettings(job, jobArgs);

                scheduledJobs.push({
                  id: job.attrs._id.toString(),
                  nextRunAt: job.attrs.nextRunAt.toString()
                });
              }
              resolve(scheduledJobs);
            } else {
              throw new Error('Invalid input: jobs should be an array.');
            }
          } catch (error) {
            reject(error);
          }
        });
      });
    } else {
      console.error('User not authorized to schedule jobs');
      return null;
    }
  } else {
    console.error('User not authenticated or userId not found');
    return null;
  }
}

// Helper function to apply optional settings to the job
async function applyOptionalSettings(job, args) {
  if (args.unique) {
    await job.unique(args.unique, {
      insertOnly: args.insertOnly
    });
  }

  if (args.forkMode) {
    await job.forkMode(true);
  }

  // Save the job after applying optional settings
  await job.save(); 
}

// Export the scheduleJobMutation function
module.exports = { scheduleJobMutation };