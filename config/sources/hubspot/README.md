# hubspot Batch Job

## Overview

The hubspot batch job is responsible for extracting CRM data from HubSpot, including relationships between entities. It follows a stream-based architecture where all data is written to a source-specific stream collection before consolidation.

## Key Features

- Incremental data extraction based on modification dates
- Rate-limited API access using Redis
- Relationship extraction using HubSpot's v4 Associations API
- Support for custom objects and event types
- Error handling with automatic retries

## Relationship Handling

### 1. Relationship Types
The job handles five core relationship types:
- Contact-Company (employment relationships)
- Contact-Deal (involvement relationships)
- Company-Deal (business relationships)
- Company-Company (parent/child, partnerships)
- Contact-Contact (referrals, reporting lines)

### 2. Data Model
Each relationship is stored with the following structure:
```javascript
{
  record: {
    id: "unique_relationship_id",
    source: {
      id: "source_entity_id",
      type: "person|organization",
      externalId: "hubspot_id"
    },
    target: {
      id: "target_entity_id",
      type: "person|organization|deal",
      externalId: "hubspot_id"
    },
    relationshipType: "employment|involvement|business|etc",
    associationTypes: [], // HubSpot-specific association labels
    attributes: {
      title: "Job Title",  // For employment relationships
      department: "Department",
      role: "Role",  // For deal involvement
      // Other relationship-specific attributes
    }
  },
  metadata: {
    sourceId: "source_instance_id",
    objectType: "relationship",
    relationshipType: "employment|involvement|business|etc",
    sourceEntityType: "contacts|companies|deals",
    targetEntityType: "contacts|companies|deals",
    sourceType: "hubspot",
    createdAt: Date,
    updatedAt: Date,
    jobHistoryId: "job_id"
  }
}
```

### 3. Relationship Processing Flow

1. **Entity Discovery**
   - Process each contact, company, and deal record
   - Extract entity IDs and types

2. **Association Fetching**
   - Use v4 Associations API to get relationships
   - Batch requests for efficiency
   - Handle rate limiting (5 requests/second)

3. **Relationship Creation**
   - Generate unique relationship IDs
   - Map HubSpot association labels to relationship types
   - Extract relationship attributes from association metadata

4. **Canonicalization**
   - Ensure consistent source/target ordering based on entity type priority
   - Normalize relationship types and attributes

5. **Stream Writing**
   - Write relationships to source stream collection
   - Handle duplicates using upsert operations

### 4. Configuration

The relationship configuration is defined in `config.json`:
```javascript
{
  "objectTypeMapping": {
    "relationship": [
      "contactCompanyRelationship",
      "contactDealRelationship",
      "companyDealRelationship",
      "companyCompanyRelationship",
      "contactContactRelationship"
    ]
  },
  "objects": {
    "contactCompanyRelationship": {
      "primaryId": "id",
      "entityA": {
        "type": "person",
        "idField": "source.id"
      },
      "entityB": {
        "type": "organization",
        "idField": "target.id"
      },
      "relationshipMapping": {
        // Mapping configuration
      }
    }
    // Other relationship configurations...
  }
}
```

### 5. Integration Points

- **Stream Collection**: `source_{id}_stream`
- **Job History**: Tracks relationship extraction progress
- **Rate Limiting**: Uses Redis for API quota management
- **Consolidation**: Feeds into relationship consolidation jobs

### 6. Error Handling

- Retries failed API calls with exponential backoff
- Logs detailed error information
- Updates job history with error details
- Continues processing on non-fatal errors

### 7. Performance Considerations

- Batches relationship writes (100 records per batch)
- Uses efficient MongoDB upsert operations
- Implements rate limiting to prevent API throttling
- Processes relationships incrementally based on entity modification dates

## Usage

The job is typically scheduled to run hourly and processes:
1. All data for new sources (backfill)
2. Modified data since last successful run (incremental)

## Dependencies

- MongoDB for data storage
- Redis for rate limiting
- HubSpot v4 Associations API access
- Valid OAuth tokens with appropriate scopes

## Monitoring

- Job history records in MongoDB
- Error logs with detailed API response information
- Rate limiting statistics in Redis
- Stream collection metrics 