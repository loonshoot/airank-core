#!/usr/bin/env node

/**
 * Script to add processByBatch: true to all models in models.yaml
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const modelsPath = path.join(__dirname, '../config/models.yaml');

// Read the YAML file
const fileContents = fs.readFileSync(modelsPath, 'utf8');
const config = yaml.load(fileContents);

// Add processByBatch to all models where allowedInBatchJobs is true
config.models = config.models.map(model => {
  if (model.allowedInBatchJobs === true && !model.hasOwnProperty('processByBatch')) {
    return {
      ...model,
      processByBatch: true
    };
  }
  return model;
});

// Convert back to YAML with proper formatting
const yamlStr = yaml.dump(config, {
  indent: 2,
  lineWidth: -1, // Don't wrap lines
  noRefs: true,
  quotingType: '"',
  forceQuotes: false
});

// Write back to file
fs.writeFileSync(modelsPath, yamlStr, 'utf8');

console.log('✓ Added processByBatch: true to all models with allowedInBatchJobs: true');
