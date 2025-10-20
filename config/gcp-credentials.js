/**
 * GCP Credentials Helper
 *
 * Handles GCP credentials from either:
 * 1. Environment variable (GCP_SERVICE_ACCOUNT_KEY) - for Dokploy/Docker
 * 2. File path (GOOGLE_APPLICATION_CREDENTIALS) - for local development
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

let credentialsSetup = false;

/**
 * Setup GCP credentials from environment variable
 * This writes the credentials to a temporary file and sets GOOGLE_APPLICATION_CREDENTIALS
 */
function setupGCPCredentials() {
  if (credentialsSetup) {
    return;
  }

  // If GOOGLE_APPLICATION_CREDENTIALS is already set and the file exists, use it
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    if (fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
      console.log('✓ Using GCP credentials from GOOGLE_APPLICATION_CREDENTIALS');
      credentialsSetup = true;
      return;
    }
  }

  // If GCP_SERVICE_ACCOUNT_KEY env var is set, write it to a temp file
  if (process.env.GCP_SERVICE_ACCOUNT_KEY) {
    try {
      // Parse to validate JSON
      const credentials = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_KEY);

      // Write to temp file
      const tmpDir = os.tmpdir();
      const credPath = path.join(tmpDir, 'gcp-credentials.json');
      fs.writeFileSync(credPath, JSON.stringify(credentials));

      // Set environment variable for Google Cloud SDKs
      process.env.GOOGLE_APPLICATION_CREDENTIALS = credPath;

      console.log('✓ GCP credentials configured from environment variable');
      credentialsSetup = true;
      return;
    } catch (error) {
      console.error('✗ Failed to parse GCP_SERVICE_ACCOUNT_KEY:', error.message);
      throw new Error('Invalid GCP_SERVICE_ACCOUNT_KEY format. Must be valid JSON.');
    }
  }

  // If neither is set, warn but don't fail (might be running locally without GCP features)
  console.warn('⚠️  No GCP credentials found. Set either:');
  console.warn('   - GCP_SERVICE_ACCOUNT_KEY (JSON string) for production');
  console.warn('   - GOOGLE_APPLICATION_CREDENTIALS (file path) for local dev');
}

/**
 * Get GCP credentials object
 * @returns {Object} Credentials object
 */
function getGCPCredentials() {
  setupGCPCredentials();

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
  }

  return null;
}

module.exports = {
  setupGCPCredentials,
  getGCPCredentials
};
