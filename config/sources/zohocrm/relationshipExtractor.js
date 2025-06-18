/**
 * Zoho CRM Relationship Extractor
 * 
 * Since Zoho CRM doesn't expose explicit relationship objects through its API,
 * this module extracts relationship data from lookup fields on primary objects
 * and creates synthetic relationship records that match our standardized schema.
 * 
 * Additionally, it can fetch related records via Zoho's Related Records API
 * to create inverse relationships (e.g., Account → Contacts).
 */

const { ObjectId } = require('mongodb');
const axios = require('axios');

/**
 * Extract relationships from Zoho objects and create synthetic relationship records
 * @param {Array} records - Array of processed Zoho records
 * @param {String} sourceId - The source ID for tracking
 * @param {Object} apiConfig - Optional API configuration for fetching related records
 * @returns {Array} Array of synthetic relationship objects
 */
async function extractRelationships(records, sourceId, apiConfig = null) {
  const relationships = [];
  
  for (const record of records) {
    try {
      // Extract relationships based on object type
      switch (record.objectType) {
        case 'Contacts':
          relationships.push(...extractContactRelationships(record, sourceId));
          break;
        case 'Leads':
          relationships.push(...extractLeadRelationships(record, sourceId));
          break;
        case 'Accounts':
          relationships.push(...extractAccountRelationships(record, sourceId));
          // If API config is provided, fetch related contacts
          if (apiConfig) {
            const relatedRelationships = await fetchAccountContactRelationships(record, sourceId, apiConfig);
            relationships.push(...relatedRelationships);
          }
          break;
        default:
          // Skip unknown object types
          continue;
      }
    } catch (error) {
      console.warn(`Failed to extract relationships from ${record.objectType} record ${record.id}:`, error.message);
    }
  }
  
  console.log(`Extracted ${relationships.length} synthetic relationships from ${records.length} Zoho records`);
  return relationships;
}

/**
 * Fetch related Contacts for an Account using Zoho's Related Records API
 * @param {Object} account - Zoho Account record
 * @param {String} sourceId - The source ID
 * @param {Object} apiConfig - API configuration {accessToken, apiDomain, rateLimiter}
 * @returns {Array} Array of Account → Contact relationships
 */
async function fetchAccountContactRelationships(account, sourceId, apiConfig) {
  const relationships = [];
  const { accessToken, apiDomain, rateLimiter } = apiConfig;
  
  if (!account.id) {
    console.warn('Account record missing ID, cannot fetch related contacts');
    return relationships;
  }
  
  try {
    console.log(`Fetching related contacts for Account ${account.id}`);
    
    // Rate limiting if provided
    if (rateLimiter) {
      await rateLimiter.removeTokens(1);
    }
    
    // Fetch related contacts using Zoho Related Records API
    const relatedUrl = `${apiDomain}/crm/v8/Accounts/${account.id}/Contacts?fields=id,First_Name,Last_Name,Email`;
    
    const response = await axios.get(relatedUrl, {
      headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` },
      timeout: 10000 // 10 second timeout
    });
    
    if (response.data && response.data.data && Array.isArray(response.data.data)) {
      const relatedContacts = response.data.data;
      console.log(`Found ${relatedContacts.length} related contacts for Account ${account.id}`);
      
      for (const contact of relatedContacts) {
        const relationship = createOrganizationContactRelationship(account, contact, sourceId);
        relationships.push(relationship);
      }
    } else {
      console.log(`No related contacts found for Account ${account.id}`);
    }
    
  } catch (error) {
    console.error(`Error fetching related contacts for Account ${account.id}:`, error.message);
    // Don't fail the main process for API errors
    if (error.response) {
      console.error(`API Response Status: ${error.response.status}`);
      console.error(`API Response Data:`, error.response.data);
    }
  }
  
  return relationships;
}

/**
 * Create an Organization → Contact relationship object
 * @param {Object} account - Zoho Account record
 * @param {Object} contact - Zoho Contact record (from related records API)
 * @param {String} sourceId - The source ID
 * @returns {Object} Synthetic relationship object
 */
function createOrganizationContactRelationship(account, contact, sourceId) {
  const contactDisplayName = getContactDisplayNameFromData(contact);
  
  return {
    _id: new ObjectId(),
    objectType: 'OrganizationContactRelationship',
    source: {
      type: 'organization',
      externalId: account.id,
      displayName: account.Account_Name || account.name || 'Unknown Account',
      zohoModule: 'Accounts'
    },
    target: {
      type: 'person',
      externalId: contact.id,
      displayName: contactDisplayName,
      zohoModule: 'Contacts'
    },
    relationshipType: 'organization_to_people',
    relationshipRole: 'has_contact',
    metadata: {
      source: 'zohocrm',
      sourceId: sourceId,
      extractedFrom: 'Account.RelatedContacts',
      synthetic: true,
      created: new Date(),
      sourceObjectType: 'Accounts',
      sourceObjectId: account.id,
      relatedRecordApi: true
    },
    externalIds: {
      zohocrm: [{
        id: `${account.id}_has_contact_${contact.id}`,
        label: 'Account to Contact Relationship',
        type: 'organization_contact_relationship',
        timestamp: new Date()
      }]
    }
  };
}

/**
 * Get display name for a Contact record from API data
 * @param {Object} contact - Contact record from Related Records API
 * @returns {String} Display name
 */
function getContactDisplayNameFromData(contact) {
  const firstName = contact.First_Name || '';
  const lastName = contact.Last_Name || '';
  const fullName = `${firstName} ${lastName}`.trim();
  return fullName || contact.Email || `Contact ${contact.id}`;
}

/**
 * Extract relationships from Zoho Contact records
 * @param {Object} contact - Zoho Contact record
 * @param {String} sourceId - The source ID
 * @returns {Array} Array of relationship objects
 */
function extractContactRelationships(contact, sourceId) {
  const relationships = [];
  
  // Contact → Account relationship (Contact.Account_Name lookup)
  if (contact.Account_Name && contact.Account_Name.id) {
    relationships.push(createContactOrganizationRelationship(contact, sourceId));
  }
  
  // Contact → Contact relationships (reporting hierarchy)
  if (contact.Reporting_To && contact.Reporting_To.id) {
    relationships.push(createContactContactRelationship(contact, sourceId));
  }
  
  return relationships;
}

/**
 * Extract relationships from Zoho Lead records
 * @param {Object} lead - Zoho Lead record
 * @param {String} sourceId - The source ID
 * @returns {Array} Array of relationship objects
 */
function extractLeadRelationships(lead, sourceId) {
  const relationships = [];
  
  // Lead → Account relationship (if Company field represents an existing Account)
  // Note: Lead.Company is typically a text field, not a lookup like Contact.Account_Name
  // We would need to implement fuzzy matching or additional logic to create relationships
  // For now, skip Lead → Account relationships unless explicit lookup exists
  
  return relationships;
}

/**
 * Extract relationships from Zoho Account records
 * @param {Object} account - Zoho Account record
 * @param {String} sourceId - The source ID
 * @returns {Array} Array of relationship objects
 */
function extractAccountRelationships(account, sourceId) {
  const relationships = [];
  
  // Account → Account relationships (parent company hierarchy)
  if (account.Parent_Account && account.Parent_Account.id) {
    relationships.push(createOrganizationOrganizationRelationship(account, sourceId));
  }
  
  return relationships;
}

/**
 * Create a Contact → Organization relationship object
 * @param {Object} contact - Zoho Contact record
 * @param {String} sourceId - The source ID
 * @returns {Object} Synthetic relationship object
 */
function createContactOrganizationRelationship(contact, sourceId) {
  return {
    _id: new ObjectId(),
    objectType: 'ContactOrganizationRelationship',
    source: {
      type: 'person',
      externalId: contact.id,
      displayName: getContactDisplayName(contact),
      zohoModule: 'Contacts'
    },
    target: {
      type: 'organization',
      externalId: contact.Account_Name.id,
      displayName: contact.Account_Name.name || 'Unknown Organization',
      zohoModule: 'Accounts'
    },
    relationshipType: 'people_to_organization',
    metadata: {
      source: 'zohocrm',
      sourceId: sourceId,
      extractedFrom: 'Contact.Account_Name',
      synthetic: true,
      created: new Date(),
      sourceObjectType: 'Contacts',
      sourceObjectId: contact.id
    },
    externalIds: {
      zohocrm: [{
        id: `${contact.id}_to_${contact.Account_Name.id}`,
        label: 'Contact to Account Relationship',
        type: 'contact_organization_relationship',
        timestamp: new Date()
      }]
    }
  };
}

/**
 * Create a Contact → Contact relationship object
 * @param {Object} contact - Zoho Contact record
 * @param {String} sourceId - The source ID
 * @returns {Object} Synthetic relationship object
 */
function createContactContactRelationship(contact, sourceId) {
  return {
    _id: new ObjectId(),
    objectType: 'ContactContactRelationship',
    source: {
      type: 'person',
      externalId: contact.id,
      displayName: getContactDisplayName(contact),
      zohoModule: 'Contacts'
    },
    target: {
      type: 'person',
      externalId: contact.Reporting_To.id,
      displayName: contact.Reporting_To.name || 'Unknown Contact',
      zohoModule: 'Contacts'
    },
    relationshipType: 'people_to_people',
    relationshipRole: 'reports_to',
    metadata: {
      source: 'zohocrm',
      sourceId: sourceId,
      extractedFrom: 'Contact.Reporting_To',
      synthetic: true,
      created: new Date(),
      sourceObjectType: 'Contacts',
      sourceObjectId: contact.id
    },
    externalIds: {
      zohocrm: [{
        id: `${contact.id}_reports_to_${contact.Reporting_To.id}`,
        label: 'Contact Reports To Relationship',
        type: 'contact_contact_relationship',
        timestamp: new Date()
      }]
    }
  };
}

/**
 * Create an Organization → Organization relationship object
 * @param {Object} account - Zoho Account record
 * @param {String} sourceId - The source ID
 * @returns {Object} Synthetic relationship object
 */
function createOrganizationOrganizationRelationship(account, sourceId) {
  return {
    _id: new ObjectId(),
    objectType: 'OrganizationOrganizationRelationship',
    source: {
      type: 'organization',
      externalId: account.id,
      displayName: account.Account_Name || 'Unknown Account',
      zohoModule: 'Accounts'
    },
    target: {
      type: 'organization',
      externalId: account.Parent_Account.id,
      displayName: account.Parent_Account.name || 'Unknown Parent Account',
      zohoModule: 'Accounts'
    },
    relationshipType: 'organization_to_organization',
    relationshipRole: 'subsidiary_of',
    metadata: {
      source: 'zohocrm',
      sourceId: sourceId,
      extractedFrom: 'Account.Parent_Account',
      synthetic: true,
      created: new Date(),
      sourceObjectType: 'Accounts',
      sourceObjectId: account.id
    },
    externalIds: {
      zohocrm: [{
        id: `${account.id}_subsidiary_of_${account.Parent_Account.id}`,
        label: 'Account Subsidiary Relationship',
        type: 'organization_organization_relationship',
        timestamp: new Date()
      }]
    }
  };
}

/**
 * Get display name for a Contact record
 * @param {Object} contact - Zoho Contact record
 * @returns {String} Display name
 */
function getContactDisplayName(contact) {
  const firstName = contact.First_Name || '';
  const lastName = contact.Last_Name || '';
  const fullName = `${firstName} ${lastName}`.trim();
  return fullName || contact.Email || `Contact ${contact.id}`;
}

/**
 * Inject synthetic relationship records into the processing pipeline
 * This function should be called during the consolidation process to add
 * the extracted relationships to the records being processed
 * 
 * @param {Array} allRecords - All records being processed
 * @param {String} sourceId - The source ID
 * @param {Object} apiConfig - Optional API configuration for fetching related records
 * @returns {Array} Records with synthetic relationships injected
 */
async function injectSyntheticRelationships(allRecords, sourceId, apiConfig = null) {
  // Extract relationships from primary objects
  const syntheticRelationships = await extractRelationships(allRecords, sourceId, apiConfig);
  
  if (syntheticRelationships.length > 0) {
    console.log(`Injecting ${syntheticRelationships.length} synthetic relationships into processing pipeline`);
    
    // Add synthetic relationships to the records array
    allRecords.push(...syntheticRelationships);
  }
  
  return allRecords;
}

/**
 * Check if a record has extractable relationship data
 * @param {Object} record - Zoho record
 * @returns {Boolean} Whether the record has relationship data
 */
function hasExtractableRelationships(record) {
  switch (record.objectType) {
    case 'Contacts':
      return !!(record.Account_Name?.id || record.Reporting_To?.id);
    case 'Leads':
      // Currently no extractable relationships from Leads
      return false;
    case 'Accounts':
      // Accounts can have both direct relationships (Parent_Account) and related contacts via API
      return !!(record.Parent_Account?.id || record.id); // If account has ID, it can potentially have related contacts
    default:
      return false;
  }
}

/**
 * Validate that a synthetic relationship has all required fields
 * @param {Object} relationship - Synthetic relationship object
 * @returns {Boolean} Whether the relationship is valid
 */
function validateSyntheticRelationship(relationship) {
  const required = ['objectType', 'source', 'target', 'relationshipType', 'metadata'];
  
  for (const field of required) {
    if (!relationship[field]) {
      console.warn(`Invalid synthetic relationship: missing field '${field}'`);
      return false;
    }
  }
  
  // Validate source and target structure
  if (!relationship.source.externalId || !relationship.source.type) {
    console.warn('Invalid synthetic relationship: source missing externalId or type');
    return false;
  }
  
  if (!relationship.target.externalId || !relationship.target.type) {
    console.warn('Invalid synthetic relationship: target missing externalId or type');
    return false;
  }
  
  return true;
}

module.exports = {
  extractRelationships,
  injectSyntheticRelationships,
  hasExtractableRelationships,
  validateSyntheticRelationship,
  createContactOrganizationRelationship,
  createContactContactRelationship,
  createOrganizationOrganizationRelationship,
  createOrganizationContactRelationship,
  fetchAccountContactRelationships
}; 