const Agenda = require('agenda');
require('dotenv').config();
const { Member } = require('../../queries/member');
const { getEntitlements } = require('../helpers/entitlements');

// Convert jobFrequency to Agenda repeat interval
function getRepeatInterval(jobFrequency) {
  switch (jobFrequency) {
    case 'daily':
      return '1 day';
    case 'weekly':
      return '1 week';
    case 'monthly':
      return '1 month';
    case 'custom':
      return null; // Don't auto-schedule for custom plans
    default:
      return '1 month';
  }
}

// Async function to schedule a job with Agenda
async function scheduleJobMutation(parent, args, { user }) {
  if (user && (user.sub)) {
    const member = await Member.findOne({
      workspaceId: args.workspaceId,
      userId: user.sub,
      permissions: "mutation:scheduleJobs"
    });
    if (member) {
      return new Promise(async (resolve, reject) => {
        const mongoUri = `${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`;
        const scheduledJobs = [];

        // Get entitlements to determine job frequency
        let entitlements;
        try {
          entitlements = await getEntitlements(args.workspaceId);
        } catch (err) {
          console.error('Error getting entitlements:', err);
          entitlements = { jobFrequency: 'monthly' }; // Default fallback
        }

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
                const isPromptModelTester = jobArgs.name === 'promptModelTester';
                const repeatInterval = getRepeatInterval(entitlements.jobFrequency);

                if (jobArgs.schedule && jobArgs.schedule.toLowerCase() === 'now') {
                  // Run the job immediately
                  job = await agenda.now(jobArgs.name, jobArgs.data);
                  await job.save();

                  // For promptModelTester jobs, also create a separate recurring job
                  if (isPromptModelTester && repeatInterval) {
                    console.log(`Creating recurring ${entitlements.jobFrequency} schedule for promptModelTester`);
                    const recurringJob = await agenda.create(jobArgs.name, jobArgs.data);
                    await recurringJob.repeatEvery(repeatInterval, { skipImmediate: true });
                    await recurringJob.save();
                    console.log(`Set up recurring job with interval: ${repeatInterval}`);
                  }
                } else if (jobArgs.schedule) {
                  job = await agenda.schedule(jobArgs.schedule, jobArgs.name, jobArgs.data);

                  // For promptModelTester jobs, also set up recurring schedule
                  if (isPromptModelTester && repeatInterval) {
                    await job.repeatEvery(repeatInterval, { skipImmediate: true });
                    console.log(`Set up recurring ${entitlements.jobFrequency} schedule for promptModelTester`);
                  }

                  await job.save();
                } else if (jobArgs.repeatEvery) {
                  job = await agenda.create(jobArgs.name, jobArgs.data);
                  await job.repeatEvery(jobArgs.repeatEvery, {
                    skipImmediate: jobArgs.skipImmediate || false
                  });
                  await job.save();
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