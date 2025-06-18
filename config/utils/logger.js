/**
 * Enhanced logging utility functions
 * Provides standardized logging for all job handlers
 */

/**
 * Log informational messages
 * @param {string} jobId - The ID of the current job
 * @param {string} message - The message to log
 * @param {*} data - Optional data to include in the log
 */
function logInfo(jobId, message, data = null) {
  const logMsg = `[zohocrm][${jobId}] 🔵 ${message}`;
  if (data) {
    console.log(logMsg, typeof data === 'object' ? JSON.stringify(data, null, 2) : data);
  } else {
    console.log(logMsg);
  }
}

/**
 * Log error messages
 * @param {string} jobId - The ID of the current job
 * @param {string} message - The error message
 * @param {Error} error - Optional error object with additional details
 */
function logError(jobId, message, error = null) {
  const errorDetails = error ? 
    (error.response?.data ? JSON.stringify(error.response.data, null, 2) : error.message) : '';
  
  console.error(`[zohocrm][${jobId}] 🔴 ERROR: ${message}`, errorDetails);
  
  // Log stack trace for non-API errors
  if (error && !error.response && error.stack) {
    console.error(`[zohocrm][${jobId}] 🔴 Stack trace:`, error.stack);
  }
}

/**
 * Log success messages
 * @param {string} jobId - The ID of the current job
 * @param {string} message - The success message
 * @param {*} data - Optional data to include in the log
 */
function logSuccess(jobId, message, data = null) {
  const logMsg = `[zohocrm][${jobId}] ✅ ${message}`;
  if (data) {
    console.log(logMsg, typeof data === 'object' ? JSON.stringify(data, null, 2) : data);
  } else {
    console.log(logMsg);
  }
}

/**
 * Log warning messages
 * @param {string} jobId - The ID of the current job
 * @param {string} message - The warning message
 * @param {*} data - Optional data to include in the log
 */
function logWarning(jobId, message, data = null) {
  const logMsg = `[zohocrm][${jobId}] ⚠️ ${message}`;
  if (data) {
    console.log(logMsg, typeof data === 'object' ? JSON.stringify(data, null, 2) : data);
  } else {
    console.log(logMsg);
  }
}

module.exports = {
  logInfo,
  logError,
  logSuccess,
  logWarning
}; 