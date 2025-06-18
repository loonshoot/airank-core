const path = require('path');
const fs = require('fs').promises;

// Function to load all configs from a directory
async function loadConfigs(directory) {
  const configs = {};
  try {
    const items = await fs.readdir(directory, { withFileTypes: true });
    
    for (const item of items) {
      if (item.isDirectory()) {
        const subConfigs = await loadConfigs(path.join(directory, item.name));
        configs[item.name] = subConfigs;
      } else if (item.name.endsWith('.json')) {
        const content = await fs.readFile(path.join(directory, item.name), 'utf8');
        const name = item.name.replace('.json', '');
        configs[name] = JSON.parse(content);
      }
    }
  } catch (error) {
    console.error(`Error loading configs from ${directory}:`, error);
  }
  return configs;
}

// Export functions to load configs
module.exports = {
  async loadSourceConfigs() {
    return loadConfigs(path.join(__dirname, 'sources'));
  },
  
  async loadCommonConfigs() {
    return loadConfigs(path.join(__dirname, 'common'));
  },
  
  // Synchronous access to config paths
  paths: {
    sources: path.join(__dirname, 'sources'),
    common: path.join(__dirname, 'common')
  }
}; 