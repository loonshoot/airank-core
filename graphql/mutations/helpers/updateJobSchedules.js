const Agenda = require('agenda');
require('dotenv').config();

/**
 * Convert jobFrequency to Agenda repeat interval
 */
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

/**
 * Update recurring job schedules based on new job frequency
 * This is called when a workspace changes plans
 */
async function updateJobSchedules(workspaceId, newJobFrequency) {
  const mongoUri = `${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`;
  const agenda = new Agenda({ db: { address: mongoUri, collection: 'jobs' } });

  return new Promise((resolve, reject) => {
    agenda.on('ready', async () => {
      try {
        console.log(`Updating job schedules for workspace ${workspaceId} to ${newJobFrequency}`);

        // Find all promptModelTester jobs for this workspace
        const jobs = await agenda.jobs({
          name: 'promptModelTester',
          'data.workspaceId': workspaceId
        });

        console.log(`Found ${jobs.length} promptModelTester job(s) for workspace`);

        const repeatInterval = getRepeatInterval(newJobFrequency);

        if (!repeatInterval) {
          // Custom plan - remove recurring schedule
          for (const job of jobs) {
            if (job.attrs.repeatInterval) {
              console.log(`Removing recurring schedule for job ${job.attrs._id}`);
              job.attrs.repeatInterval = null;
              job.attrs.repeatTimezone = null;
              await job.save();
            }
          }
        } else {
          // Update recurring schedule for all jobs
          for (const job of jobs) {
            console.log(`Updating job ${job.attrs._id} to repeat every ${repeatInterval}`);
            await job.repeatEvery(repeatInterval, { skipImmediate: true });
            await job.save();
          }
        }

        await agenda.stop();
        resolve({
          updated: jobs.length,
          newFrequency: newJobFrequency,
          repeatInterval
        });
      } catch (error) {
        console.error('Error updating job schedules:', error);
        await agenda.stop();
        reject(error);
      }
    });

    agenda.on('error', (error) => {
      console.error('Agenda error:', error);
      reject(error);
    });
  });
}

module.exports = { updateJobSchedules, getRepeatInterval };
