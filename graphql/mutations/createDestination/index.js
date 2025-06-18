const mongoose = require('mongoose');
const crypto = require('crypto');
const { Member } = require('../../queries/member');

// Define the destination schema
const destinationSchema = new mongoose.Schema({
  name: String,
  status: { type: String, default: 'active' },
  tokenId: String,
  destinationType: String,
  targetSystem: String,
  rateLimits: {
    requestsPerInterval: Number,
    intervalMs: Number
  },
  mappings: {
    people: {
      enabled: Boolean,
      fields: [String]
    },
    organizations: {
      enabled: Boolean,
      fields: [String]
    }
  },
  listenerIds: [String],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Async function to establish the database connection
async function createConnection(workspaceId) {
  const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
  try {
    const datalake = mongoose.createConnection(dataLakeUri);
    datalake.model('Destination', destinationSchema);
    await datalake.asPromise();
    console.log(`Connected to workspace database: ${dataLakeUri}`);
    return datalake;
  } catch (error) {
    console.error('Error connecting to workspace database:', error);
    throw error;
  }
}

// Function to create listeners for the destination
async function createDestinationListeners(workspaceId, destinationId, destinationType, mappings, rateLimits) {
  try {
    const outrunUri = `${process.env.MONGODB_URI}/outrun?${process.env.MONGODB_PARAMS}`;
    const outrunDb = mongoose.createConnection(outrunUri);
    await outrunDb.asPromise();

    const listenersCollection = outrunDb.collection('listeners');
    const createdListenerIds = [];

    // Load config to get field mappings
    const config = require('@outrun/config');
    const sourceConfigs = await config.loadSourceConfigs();
    
    // Ensure we look up the correct config - destinationType may be "HubSpot" with capital H
    // but config is stored as lowercase "hubspot"
    const configKey = `${destinationType.toLowerCase()}`;
    console.log(`Looking up config for: ${configKey}`);
    const sourceConfig = sourceConfigs[configKey] || {};
    
    // Log the available configs if the one we need isn't found
    if (!sourceConfig.destinationMapping) {
      console.error(`Config for ${configKey} not found or missing destinationMapping. Available configs:`, Object.keys(sourceConfigs));
    } else {
      console.log(`Found config for ${configKey} with destinationMapping:`, 
                 JSON.stringify(sourceConfig.destinationMapping));
    }
    
    const objectTypeMapping = sourceConfig.objectTypeMapping || {};
    
    // Generate the job name dynamically from the destinationType
    // This ensures different destination types use their corresponding job handlers
    // Format: "hubspotDestination" for destinationType "hubspot"
    const formatJobName = (type) => {
      // Extract just the platform name if there are multiple words
      const platformName = type.split(/\s+/)[0];
      
      // Format in camelCase - lowercase first letter, remove spaces
      const formattedName = platformName.toLowerCase().replace(/\s+/g, '');
      return `${formattedName}Destination`;
    };
    
    const jobName = formatJobName(destinationType);
    console.log(`Using job name: ${jobName} for destination type: ${destinationType}`);
    
    // Helper function to get the collection to watch for a given object type
    // For the export direction, we use the object type directly as the collection name
    // This ensures we watch the consolidated collections (people, organizations) rather than
    // the imported collections (contacts, companies)
    const getExportCollection = (objectType) => {
      // Default to using the object type directly as the collection name
      // This ensures we watch the consolidated collection by default
      return objectType;
    };
    
    // Helper function to get the external object type that this maps to
    // For example, 'people' in our system maps to 'contacts' in HubSpot
    const getExternalObjectType = (objectType) => {
      const mapping = objectTypeMapping[objectType];
      if (mapping && mapping.length > 0) {
        return mapping[0]; // Use the first mapping as the primary external type
      }
      return objectType; // Default to same name if no mapping found
    };
    
    // Get the actual field names from the config
    const configFieldMappings = {
      people: sourceConfig.destinationMapping?.people?.availableFields || [
        // Default fields if config is missing
        "emailAddress", "firstName", "lastName", "phoneNumbers", "jobTitle", "company"
      ],
      organizations: sourceConfig.destinationMapping?.organizations?.availableFields || [
        // Default fields if config is missing
        "companyName", "domain", "website", "country", "industry", "description"
      ]
    };
    
    console.log(`Using field mappings:`, JSON.stringify(configFieldMappings));

    // Create people listener if enabled
    if (mappings.people && mappings.people.enabled) {
      // For export direction, watch the consolidated 'people' collection
      const collectionName = getExportCollection('people');
      const externalObjectType = getExternalObjectType('people');
      
      // Use the correct field names from config
      const peopleFields = configFieldMappings.people;
      
      // Ensure we have at least default fields if none are found
      if (!peopleFields.length) {
        console.warn(`No fields found for people in config, using defaults`);
        // Use default fields that will always exist
        peopleFields.push("emailAddress", "firstName", "lastName", "phoneNumbers");
        console.log(`Using default fields for people: ${JSON.stringify(peopleFields)}`);
      }
      
      // Create a dynamic filter for each field to watch
      const fieldFilters = {};
      peopleFields.forEach(field => {
        fieldFilters[`updateDescription.updatedFields.${field}`] = { $exists: true };
      });
      
      const peopleListener = {
        collection: collectionName,
        // Use a more precise filter that matches any of the watched fields
        filter: {
          $or: [
            // Option 1: Traditional field-based matching
            { "updateDescription.updatedFields": { 
              $in: peopleFields
            }},
            // Option 2: Direct field path matching (more precise)
            ...Object.keys(fieldFilters).map(path => ({ [path]: fieldFilters[path] }))
          ]
        },
        operationType: ['update'],
        jobName: jobName,
        isActive: true,
        metadata: {
          type: 'destination',
          workspaceId,
          destinationId,
          destinationType,
          objectType: 'people',
          // Destination listeners should handle any object type
          // This flag tells the listener to ignore object type checks
          handleAnyObjectType: true,
          mappedSourceTypes: [externalObjectType], // When syncing to HubSpot, map to external type
          collection: collectionName,
          fields: peopleFields,
          rateLimits
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      console.log(`Creating listener for ${destinationType} destination with filter:`, JSON.stringify(peopleListener.filter));
      const result = await listenersCollection.insertOne(peopleListener);
      createdListenerIds.push(result.insertedId.toString());
      console.log(`Created listener for ${destinationType} destination on '${collectionName}' collection for people objects`);
    }

    // Create organizations listener if enabled
    if (mappings.organizations && mappings.organizations.enabled) {
      // For export direction, watch the consolidated 'organizations' collection
      const collectionName = getExportCollection('organizations');
      const externalObjectType = getExternalObjectType('organizations');
      
      // Use the correct field names from config
      const organizationFields = configFieldMappings.organizations;
      
      // Ensure we have at least default fields if none are found
      if (!organizationFields.length) {
        console.warn(`No fields found for organizations in config, using defaults`);
        // Use default fields that will always exist
        organizationFields.push("companyName", "domain", "website", "country");
        console.log(`Using default fields for organizations: ${JSON.stringify(organizationFields)}`);
      }
      
      // Create a dynamic filter for each field to watch
      const fieldFilters = {};
      organizationFields.forEach(field => {
        fieldFilters[`updateDescription.updatedFields.${field}`] = { $exists: true };
      });
      
      const orgsListener = {
        collection: collectionName,
        // Use a more precise filter that matches any of the watched fields
        filter: {
          $or: [
            // Option 1: Traditional field-based matching
            { "updateDescription.updatedFields": { 
              $in: organizationFields
            }},
            // Option 2: Direct field path matching (more precise)
            ...Object.keys(fieldFilters).map(path => ({ [path]: fieldFilters[path] }))
          ]
        },
        operationType: ['update'],
        jobName: jobName,
        isActive: true,
        metadata: {
          type: 'destination',
          workspaceId,
          destinationId,
          destinationType,
          objectType: 'organizations',
          // Destination listeners should handle any object type
          // This flag tells the listener to ignore object type checks
          handleAnyObjectType: true,
          mappedSourceTypes: [externalObjectType], // When syncing to HubSpot, map to external type
          collection: collectionName,
          fields: organizationFields,
          rateLimits
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      console.log(`Creating listener for ${destinationType} destination with filter:`, JSON.stringify(orgsListener.filter));
      const result = await listenersCollection.insertOne(orgsListener);
      createdListenerIds.push(result.insertedId.toString());
      console.log(`Created listener for ${destinationType} destination on '${collectionName}' collection for organizations objects`);
    }

    await outrunDb.close();
    return createdListenerIds;
  } catch (error) {
    console.error('Error creating destination listeners:', error);
    throw error;
  }
}

// Function to schedule the initial sync job
async function scheduleInitialSyncJob(workspaceId, destinationId, destinationType, mappings) {
  try {
    const outrunUri = `${process.env.MONGODB_URI}/outrun?${process.env.MONGODB_PARAMS}`;
    const outrunDb = mongoose.createConnection(outrunUri);
    await outrunDb.asPromise();

    // Get the Agenda instance
    const Agenda = require('agenda');
    const agenda = new Agenda({ db: { address: outrunUri, collection: 'jobs' } });

    await new Promise((resolve) => agenda.once('ready', resolve));
    
    // Load config to get field mappings
    const config = require('@outrun/config');
    const sourceConfigs = await config.loadSourceConfigs();
    const sourceConfig = sourceConfigs[`${destinationType.toLowerCase()}`] || {};
    const objectTypeMapping = sourceConfig.objectTypeMapping || {};
    
    // Generate the job name dynamically from the destinationType
    // This ensures different destination types use their corresponding job handlers
    // Format: "hubspotDestination" for destinationType "hubspot"
    const formatJobName = (type) => {
      // Extract just the platform name if there are multiple words
      const platformName = type.split(/\s+/)[0];
      
      // Format in camelCase - lowercase first letter, remove spaces
      const formattedName = platformName.toLowerCase().replace(/\s+/g, '');
      return `${formattedName}Destination`;
    };
    
    const jobName = formatJobName(destinationType);
    console.log(`Using job name: ${jobName} for initial sync jobs for destination type: ${destinationType}`);
    
    // Helper function to get the collection to watch for a given object type
    // For the export direction, we use the object type directly as the collection name
    const getExportCollection = (objectType) => {
      // Default to using the object type directly as the collection name
      return objectType;
    };
    
    // Helper function to get the external object type that this maps to
    const getExternalObjectType = (objectType) => {
      const mapping = objectTypeMapping[objectType];
      if (mapping && mapping.length > 0) {
        return mapping[0]; // Use the first mapping as the primary external type
      }
      return objectType; // Default to same name if no mapping found
    };
    
    // Get the actual field names from the config
    const configFieldMappings = {
      people: sourceConfig.destinationMapping?.people?.availableFields || [
        // Default fields if config is missing
        "emailAddress", "firstName", "lastName", "phoneNumbers", "jobTitle", "company"
      ],
      organizations: sourceConfig.destinationMapping?.organizations?.availableFields || [
        // Default fields if config is missing
        "companyName", "domain", "website", "country", "industry", "description"
      ]
    };
    
    // Create jobs for each enabled mapping type
    const jobs = [];
    
    // Schedule people sync job if enabled
    if (mappings.people && mappings.people.enabled) {
      // For export direction, use the consolidated 'people' collection
      const collectionName = getExportCollection('people');
      
      // Use the correct field names from config
      const peopleFields = configFieldMappings.people;
      
      // Ensure we have at least default fields if none are found
      if (!peopleFields.length) {
        console.warn(`No fields found for people in config for initial sync, using defaults`);
        // Use default fields that will always exist
        peopleFields.push("emailAddress", "firstName", "lastName", "phoneNumbers");
        console.log(`Using default fields for people initial sync: ${JSON.stringify(peopleFields)}`);
      }
      
      const peopleJob = await agenda.create(jobName, {
        workspaceId,
        destinationId,
        objectType: 'people',
        fields: peopleFields,
        isInitialSync: true,
        collection: collectionName
      });
      
      // Run immediately
      await peopleJob.schedule('now');
      await peopleJob.save();
      jobs.push(peopleJob);
      
      console.log(`Scheduled initial people sync job for destination ${destinationId} using collection ${collectionName}`);
    }
    
    // Schedule organizations sync job if enabled
    if (mappings.organizations && mappings.organizations.enabled) {
      // For export direction, use the consolidated 'organizations' collection
      const collectionName = getExportCollection('organizations');
      
      // Use the correct field names from config
      const organizationFields = configFieldMappings.organizations;
      
      // Ensure we have at least default fields if none are found
      if (!organizationFields.length) {
        console.warn(`No fields found for organizations in config for initial sync, using defaults`);
        // Use default fields that will always exist
        organizationFields.push("companyName", "domain", "website", "country");
        console.log(`Using default fields for organizations initial sync: ${JSON.stringify(organizationFields)}`);
      }
      
      const orgsJob = await agenda.create(jobName, {
        workspaceId,
        destinationId,
        objectType: 'organizations',
        fields: organizationFields,
        isInitialSync: true,
        collection: collectionName
      });
      
      // Run immediately
      await orgsJob.schedule('now');
      await orgsJob.save();
      jobs.push(orgsJob);
      
      console.log(`Scheduled initial organizations sync job for destination ${destinationId} using collection ${collectionName}`);
    }
    
    await outrunDb.close();
    return jobs.map(job => job.attrs._id.toString());
  } catch (error) {
    console.error('Error scheduling initial sync job:', error);
    throw error;
  }
}

// Async function to create a new destination
async function createDestination(parent, args, { user }) {
  if (user && (user.sub)) {
    const workspaceId = args.workspaceId;
    try {
      // Find member with the user's email and permission
      const member = await Member.findOne({ workspaceId: workspaceId, userId: user.sub,
        permissions: "mutation:createDestination" // Check for "mutation:createDestination" permission
      });

      if (member) { // If member found and has permission
        // Validate the input data
        if (!args.name || !args.tokenId || !args.targetSystem || !args.mappings) {
          throw new Error('Missing required fields');
        }

        // Use the destinationType directly from the args
        // The frontend already sends the correct destinationType (e.g., "zohocrm", "salesforce", "hubspot")
        const destinationType = args.destinationType;
        
        // Dynamically load provider from config file instead of hardcoding
        let provider = destinationType; // fallback to destinationType if config not found
        try {
          const path = require('path');
          const fs = require('fs').promises;
          const configPath = path.join(__dirname, '../../../config/sources', destinationType, 'config.json');
          
          const configContent = await fs.readFile(configPath, 'utf8');
          const config = JSON.parse(configContent);
          provider = config.provider || destinationType;
          console.log(`Loaded provider "${provider}" from config file for ${destinationType}`);
        } catch (error) {
          console.log(`Config file not found for ${destinationType}, using "${provider}" as provider fallback`);
        }
        
        console.log(`Using platform "${destinationType}" from targetSystem "${args.targetSystem}", provider: "${provider}"`);

        // Connect to the database
        const datalake = await createConnection(workspaceId);

        // Create the destination object
        const newDestination = datalake.model('Destination')({
          name: args.name,
          status: "active",
          tokenId: args.tokenId,
          destinationType: destinationType, // Use the extracted platform name
          targetSystem: args.targetSystem,
          provider: provider, // Set provider field
          rateLimits: args.rateLimits || {
            requestsPerInterval: 10,
            intervalMs: 1000
          },
          mappings: args.mappings
        });

        // Save the destination document
        await newDestination.save();

        // Create the listeners for this destination
        const listenerIds = await createDestinationListeners(
          workspaceId,
          newDestination._id.toString(),
          destinationType, // Use the extracted platform name
          args.mappings,
          newDestination.rateLimits
        );

        // Update the destination with listener IDs
        newDestination.listenerIds = listenerIds;
        await newDestination.save();

        // Schedule initial sync job to synchronize all existing records
        await scheduleInitialSyncJob(workspaceId, newDestination._id.toString(), destinationType, args.mappings);

        // Disconnect from the database
        await datalake.close();

        // Return the newly created destination
        return {
          _id: newDestination._id,
          name: newDestination.name,
          status: newDestination.status,
          tokenId: newDestination.tokenId,
          destinationType: newDestination.destinationType,
          targetSystem: newDestination.targetSystem,
          rateLimits: newDestination.rateLimits,
          mappings: newDestination.mappings,
          listenerIds: newDestination.listenerIds,
          createdAt: newDestination.createdAt,
          updatedAt: newDestination.updatedAt
        };
      } else {
        console.error('User not authorized to create destinations');
        return null; // Return null if user doesn't have permission
      }
    } catch (error) {
      console.error('Error creating destination:', error);
      throw error;
    }
  } else {
    console.error('User not authenticated');
    return null;
  }
}

// Export the createDestination function
module.exports = { createDestination }; 