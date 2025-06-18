# salesforce Batch Job

## Overview

The salesforce batch job extracts CRM data from Salesforce, including contacts, accounts, and relationships between entities. It follows a stream-based architecture where data is written to a source-specific stream collection before consolidation.

## Key Features

- Incremental data extraction based on modification dates
- Rate-limited API access to respect Salesforce API limits
- Relationship extraction for Contact-Account and related associations
- Support for custom objects and fields
- Error handling with automatic retries

## Data Model

### Object Types
The job extracts and processes these primary object types:
- `Contact`: Mapped to people in the unified data model
- `Account`: Mapped to organizations in the unified data model
- Various relationship types (ContactAccountRelationship, etc.)

### Record Structure
Each record follows this structure:
```javascript
{
  record: {
    Id: "001gL000004kVPtQAM",  // Salesforce ID
    Name: "Acme Corp",  // Original field names from Salesforce
    Website: "https://acme.com",
    // Other Salesforce fields...
  },
  metadata: {
    sourceId: "source_instance_id",
    objectType: "Account",  // Original Salesforce object type
    sourceType: "salesforce",
    createdAt: Date,
    updatedAt: Date,
    jobHistoryId: "job_id"
  }
}
```

## Relationship Handling

### 1. Relationship Types
The job handles these core relationship types:
- Contact-Account (employment relationships)
- Contact-Opportunity (involvement relationships)
- Account-Opportunity (business relationships)
- Account-Account (parent/child, partnerships)
- Contact-Contact (referrals, reporting lines)

### 2. Relationship Data Model
Each relationship is stored with the following structure:
```javascript
{
  record: {
    Id: "unique_relationship_id",
    source: {
      id: "source_entity_id",
      type: "person|organization",
      externalId: "salesforce_id"
    },
    target: {
      id: "target_entity_id",
      type: "person|organization|deal",
      externalId: "salesforce_id"
    },
    relationshipType: "employment|involvement|business|etc",
    attributes: {
      title: "Job Title",  // For employment relationships
      department: "Department",
      role: "Role",  // For deal involvement
      // Other relationship-specific attributes
    }
  },
  metadata: {
    sourceId: "source_instance_id",
    objectType: "ContactAccountRelationship",
    sourceType: "salesforce",
    createdAt: Date,
    updatedAt: Date,
    jobHistoryId: "job_id"
  }
}
```

## Configuration

The salesforce configuration (`config.json`) defines:

1. **Object Type Mapping**: Maps Salesforce objects to unified model entities
```javascript
"objectTypeMapping": {
  "people": ["Contact"],
  "organizations": ["Account"],
  "relationship": ["ContactAccountRelationship", "ContactOpportunityRelationship", ...]
}
```

2. **Field Mappings**: Configure how Salesforce fields map to unified model fields
```javascript
"objects": {
  "Contact": {
    "primaryId": "Id",
    "peopleMapping": {
      "emailAddress": "Email",
      "firstName": "FirstName",
      "lastName": "LastName",
      // More field mappings...
    }
  }
}
```

3. **Index Configuration**: Defines MongoDB index configuration for optimized querying
```javascript
"indexConfig": {
  "common": [
    { "externalIds.salesforce.id": 1, "options": { "background": true, "sparse": true } }
  ],
  "people": [
    { "emailAddress": 1, "options": { "background": true, "sparse": true } }
  ],
  // More collection-specific indexes...
}
```

## Special Considerations

### ID Handling
- salesforce uses Salesforce native IDs (like `001gL000004kVPtQAM`) as `externalId`
- IDs are preserved at both the record level and in `externalIds` collections

### Field Formats
- Dates are stored in ISO format from Salesforce's native format
- Phone numbers and addresses maintain Salesforce's structure before transformation

### Relationships
- The `AccountId` field in Contact records is used to establish Contact-Account relationships
- Junction objects are used to handle many-to-many relationships

## Usage

The job is typically scheduled to run hourly and processes:
1. All data for new sources (backfill)
2. Modified data since last successful run (incremental)

## Dependencies

- MongoDB for data storage
- Valid Salesforce OAuth tokens with appropriate API access
- Default API version: 57.0

## Monitoring

- Job history records in MongoDB
- Error logs with detailed API response information
- Rate limiting statistics to prevent API throttling
- Stream collection metrics 