const mongoose = require('mongoose');
const { createConnection } = require('../../../config/providers/salesforce/api');
const jwt = require('jsonwebtoken');

/**
 * Handle Salesforce webhook events from Pub/Sub API
 * This function processes incoming events from Salesforce Platform Events and Change Data Capture
 */
async function handleSalesforceWebhook(req, res) {
  try {
    console.log('\n========== SALESFORCE WEBHOOK RECEIVED ==========');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log(`Headers: ${JSON.stringify(req.headers, null, 2)}`);
    
    // Log the body but truncate if too large
    const bodyStr = JSON.stringify(req.body, null, 2);
    console.log(`Body: ${bodyStr.length > 1000 ? bodyStr.substring(0, 1000) + '... (truncated)' : bodyStr}`);
    console.log('================================================\n');

    // Check if this is a forwarded request from the API gateway
    const isForwardedRequest = req.body?.source === 'salesforce' && req.body?.data;
    
    // If it's forwarded, extract the actual Salesforce data
    const salesforceData = isForwardedRequest ? req.body.data : req.body;
    
    // Handle both direct Salesforce events and forwarded events from API gateway
    // Salesforce sends events in different formats depending on the API
    // We need to handle multiple possible formats
    let events = [];
    
    if (Array.isArray(salesforceData)) {
      // Array of events
      events = salesforceData;
    } else if (salesforceData.events && Array.isArray(salesforceData.events)) {
      // Object with events array
      events = salesforceData.events;
    } else if (salesforceData.data && Array.isArray(salesforceData.data)) {
      // Nested data property with events
      events = salesforceData.data;
    } else if (salesforceData.payload && typeof salesforceData.payload === 'object') {
      // Single event with payload
      events = [salesforceData];
    } else if (salesforceData.recordId || salesforceData.Id) {
      // Single record update
      events = [{
        channelName: salesforceData.channelName || '/event/GenericChangeEvent',
        data: salesforceData,
        replayId: salesforceData.recordId || salesforceData.Id,
        source: req.headers['x-salesforce-source'] || 'salesforce'
      }];
    } else {
      // Default case - treat the entire body as a single event
      events = [{
        channelName: '/event/GenericEvent',
        data: salesforceData,
        replayId: Date.now().toString(),
        source: 'salesforce'
      }];
    }

    if (events.length === 0) {
      console.warn('No events found in payload');
      return res.status(200).json({ message: 'No events to process' });
    }

    console.log(`Processing ${events.length} Salesforce event(s)`);

    for (const event of events) {
      await processEvent(event);
    }

    return res.status(200).json({ 
      message: `Processed ${events.length} Salesforce event(s)`,
      timestamp: new Date().toISOString(),
      success: true
    });
  } catch (error) {
    console.error('Error handling Salesforce webhook:', error);
    return res.status(200).json({ 
      error: 'Error processing webhook',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Process a single Salesforce event
 */
async function processEvent(event) {
  try {
    // Extract event data
    const {
      channelName,
      source,
      data,
      replayId
    } = event;

    console.log(`Processing event from channel ${channelName}, replayId: ${replayId}`);

    // Skip non-change events - we only care about CDC events and platform events
    if (!channelName || !channelName.includes('/event/') && !channelName.includes('/data/')) {
      console.log(`Skipping event with channel ${channelName} - not a CDC or platform event`);
      return;
    }

    // Extract workspaceId and sourceId from channel
    const { workspaceId, sourceId } = extractStreamInfo(channelName, source);
    if (!workspaceId || !sourceId) {
      console.error('Unable to extract workspaceId and sourceId from event data');
      return;
    }

    // Common fields for all record types
    const record = {
      record: {
        ...data,
        _salesforceReplayId: replayId,
        _salesforceEventChannel: channelName
      },
      metadata: {
        sourceId,
        createdAt: new Date(),
        updatedAt: new Date(),
        salesforceEventTimestamp: new Date(),
        objectType: getObjectTypeFromChannel(channelName),
        sourceType: 'salesforce',
        streamType: 'pubsub'
      }
    };

    // Connect to workspace database
    const mongoUri = `${process.env.MONGODB_URI}`;
    const dataLakeUri = `${mongoUri}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
    const connection = await mongoose.createConnection(dataLakeUri).asPromise();

    try {
      // Store the event in the stream collection
      const streamCollection = connection.collection(`source_${sourceId}_stream`);
      
      // Generate a unique ID for the record if it doesn't have one
      if (!record.record.Id) {
        record.record.id = `sf_event_${replayId}`;
      }

      // Insert the record
      await streamCollection.insertOne(record);
      console.log(`Inserted Salesforce event from ${channelName} into stream collection`);
    } catch (dbError) {
      console.error('Error storing Salesforce event:', dbError);
    } finally {
      // Close connection
      await connection.close();
    }
  } catch (error) {
    console.error('Error processing Salesforce event:', error);
  }
}

/**
 * Extract workspaceId and sourceId from channel/source information
 */
function extractStreamInfo(channelName, source) {
  try {
    // Sources have a custom format in the channel name - airank_{sourceId}_{workspaceId}
    // This should be sent from Salesforce in the channel subscription name
    if (source && source.includes('airank_')) {
      const parts = source.split('_');
      if (parts.length >= 3) {
        return {
          sourceId: parts[1],
          workspaceId: parts[2]
        };
      }
    }

    // Alternative approach - check if stored in the request headers
    // This would require customization on the Salesforce side
    return {
      sourceId: null,
      workspaceId: null
    };
  } catch (error) {
    console.error('Error extracting stream info:', error);
    return {
      sourceId: null,
      workspaceId: null
    };
  }
}

/**
 * Extract object type from channel name
 */
function getObjectTypeFromChannel(channelName) {
  // CDC events have format /event/ObjectNameChangeEvent
  if (channelName.includes('/event/') && channelName.includes('ChangeEvent')) {
    return channelName.split('/event/')[1].replace('ChangeEvent', '');
  }
  
  // Platform events have format /event/CustomEventName__e
  if (channelName.includes('/event/') && channelName.includes('__e')) {
    return channelName.split('/event/')[1];
  }
  
  // Data events have format /data/ObjectName
  if (channelName.includes('/data/')) {
    return channelName.split('/data/')[1];
  }
  
  // If we can't determine it, use a default
  return 'SalesforceEvent';
}

module.exports = {
  handleSalesforceWebhook
}; 