const { submitOpenAIBatch, checkOpenAIBatchStatus, downloadOpenAIBatchResults } = require('./openai');
const { submitVertexBatch, checkVertexBatchStatus, downloadVertexBatchResults } = require('./vertex');

/**
 * Submit batch job based on provider
 * @param {String} provider - Provider name (openai, vertex)
 * @param {Array} requests - Array of requests
 * @param {Object} workspaceDb - MongoDB workspace database connection
 * @param {String} workspaceId - Workspace ID
 * @returns {Object} - Batch metadata
 */
async function submitBatch(provider, requests, workspaceDb, workspaceId) {
  switch (provider) {
    case 'openai':
      return await submitOpenAIBatch(requests, workspaceDb, workspaceId);
    case 'vertex':
      return await submitVertexBatch(requests, workspaceDb, workspaceId);
    default:
      throw new Error(`Unsupported batch provider: ${provider}`);
  }
}

/**
 * Check batch status based on provider
 * @param {String} provider - Provider name
 * @param {String} batchId - Batch ID
 * @param {Object} workspaceDb - MongoDB workspace database (unused, kept for compatibility)
 * @returns {Object} - Batch status
 */
async function checkBatchStatus(provider, batchId, workspaceDb = null) {
  switch (provider) {
    case 'openai':
      return await checkOpenAIBatchStatus(batchId);
    case 'vertex':
      return await checkVertexBatchStatus(batchId);
    default:
      throw new Error(`Unsupported batch provider: ${provider}`);
  }
}

/**
 * Download batch results based on provider
 * @param {String} provider - Provider name
 * @param {String} fileId - File ID or GCS prefix
 * @param {Object} workspaceDb - MongoDB workspace database connection
 * @param {String} batchId - Batch ID
 * @returns {Array} - Batch results
 */
async function downloadBatchResults(provider, fileId, workspaceDb, batchId) {
  switch (provider) {
    case 'openai':
      return await downloadOpenAIBatchResults(fileId, workspaceDb, batchId);
    case 'vertex':
      return await downloadVertexBatchResults(fileId, workspaceDb, batchId);
    default:
      throw new Error(`Unsupported batch provider: ${provider}`);
  }
}

module.exports = {
  submitBatch,
  checkBatchStatus,
  downloadBatchResults,
  // Export individual helpers for direct use
  submitOpenAIBatch,
  submitVertexBatch,
  checkOpenAIBatchStatus,
  checkVertexBatchStatus,
  downloadOpenAIBatchResults,
  downloadVertexBatchResults
};
