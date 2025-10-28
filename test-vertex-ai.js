#!/usr/bin/env node

/**
 * Test script to verify Vertex AI connectivity and permissions
 */

require('dotenv').config();
const { VertexAI } = require('@google-cloud/vertexai');

async function testVertexAI() {
  console.log('🧪 Testing Vertex AI Connection\n');

  // Display configuration
  console.log('Configuration:');
  console.log('- Project ID:', process.env.GCP_PROJECT_ID);
  console.log('- Region:', process.env.GCP_REGION);
  console.log('- Key File:', process.env.GOOGLE_APPLICATION_CREDENTIALS || './gcp-batch-processor-key.json');
  console.log();

  try {
    // Set credentials if not already set
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = './gcp-batch-processor-key.json';
    }

    // Initialize Vertex AI
    const vertexAI = new VertexAI({
      project: process.env.GCP_PROJECT_ID,
      location: process.env.GCP_REGION
    });

    console.log('✅ Vertex AI client initialized\n');

    // Test with Gemini 2.5 Flash (used for sentiment analysis)
    console.log('Testing Gemini 2.5 Flash model...');
    const model = vertexAI.getGenerativeModel({
      model: 'gemini-2.5-flash'
    });

    const prompt = 'Say "Hello, Vertex AI is working!" in one sentence.';

    console.log('Sending test request...');
    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.candidates[0].content.parts[0].text;

    console.log('\n✅ SUCCESS! Response received:');
    console.log('---');
    console.log(text);
    console.log('---\n');

    console.log('🎉 Vertex AI is fully functional!');
    console.log('✅ Service account has correct permissions');
    console.log('✅ API is enabled and accessible');

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);

    if (error.message.includes('403') || error.message.includes('Permission denied')) {
      console.error('\n🔍 Permission Issue Detected:');
      console.error('- The service account may not have roles/aiplatform.user');
      console.error('- The Vertex AI API may not be enabled');
      console.error('- Permissions may still be propagating (wait 5-10 minutes)');
    } else if (error.message.includes('404')) {
      console.error('\n🔍 Project or API Issue:');
      console.error('- Project ID may be incorrect');
      console.error('- API may not be enabled');
    } else if (error.message.includes('ENOENT')) {
      console.error('\n🔍 Credentials Issue:');
      console.error('- Service account key file not found');
      console.error('- Check GOOGLE_APPLICATION_CREDENTIALS path');
    }

    console.error('\nFull error details:');
    console.error(error);
    process.exit(1);
  }
}

testVertexAI();
