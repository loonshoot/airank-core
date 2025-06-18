# consolidateRecord Job

## Overview
The `consolidateRecord` job is the first stage in Outrun's data pipeline. It processes raw records from source-specific stream collections and moves them to a consolidated collection, maintaining their original structure. This job acts as a staging step before specialized consolidation jobs transform the data into a standardized format.

## How It Works
1. Processes records from the source-specific `source_[sourceId]_stream` collection
2. Preserves the original source structure (does not transform fields)
3. Updates existing records when updates arrive for the same entity
4. Writes records to `source_[sourceId]_consolidated` collection
5. Marks stream records as processed to prevent duplicate processing

## Position in Data Pipeline
```
Raw API Data → Stream Collection → consolidateRecord (preserves format) → Consolidated Collection → Specialized Consolidation Jobs (transform) → Unified Data Model
```

## Configuration Requirements

### Source Config Requirements
Each source (like `salesforce`) needs these configurations for the pipeline to work properly:

```json
{
  "objectTypeMapping": {
    "people": ["Contact"],
    "organizations": ["Account"],
    "relationship": ["ContactAccountRelationship"]
  },
  "defaultConfig": {
    "primaryId": "id",  // Field used to identify records for updates
    "fields": {}
  }
}
```

The other config elements (`consolidationMapping`, `objects`) are used by the specialized consolidation jobs, not by consolidateRecord directly.

### Common Configuration
The job uses its own configuration from `consolidateRecord/config.json`:

```json
{
  "consolidationOptions": {
    "useSourceMapping": true,
    "preserveSourceStructure": true,  // Critical - must be true to preserve original structure
    "includeProperties": true,
    "includeMetadata": true
  }
}
```

## Special Handling

### Relationship Records
Relationship records receive special handling:
- Detection based on object type being `relationship`
- IDs looked up in both `id` and `externalId` fields
- Additional metadata stored for relationship type and entity types

### ObjectId Handling
The job converts string IDs that match MongoDB ObjectId format to actual ObjectId types.

## Example Staging (Not Transformation)

### Contact Record
From stream collection:
```json
{
  "_id": "ObjectId(...)",
  "record": {
    "Id": "0038d00000abcDEF",
    "Email": "john@example.com",
    "FirstName": "John",
    "LastName": "Doe",
    "Phone": "555-123-4567"
  },
  "metadata": {
    "sourceType": "salesforce",
    "objectType": "Contact",
    "sourceId": "ObjectId(...)",
    "jobHistoryId": "ObjectId(...)"
  }
}
```

To consolidated collection (structure preserved):
```json
{
  "_id": "ObjectId(...)",
  "externalId": "0038d00000abcDEF",
  "sourceId": "ObjectId(...)",
  "objectType": "Contact",
  "record": {
    "Id": "0038d00000abcDEF",  // Original field names and structure preserved
    "Email": "john@example.com",
    "FirstName": "John",
    "LastName": "Doe", 
    "Phone": "555-123-4567"
  },
  "metadata": {
    "sourceId": "ObjectId(...)",
    "objectType": "Contact",
    "sourceType": "salesforce",
    "createdAt": "2023-04-20T15:30:45.123Z",
    "updatedAt": "2023-04-20T15:30:45.123Z",
    "jobHistoryId": "ObjectId(...)"
  }
}
```

The actual field transformation (e.g., `FirstName` → `firstName`) happens later in the specialized consolidation jobs, not in consolidateRecord.

## Troubleshooting
Common issues:
- **Records not being processed**: Check if the source ID and object type match in the stream record
- **Missing records**: Verify the `primaryId` field is correctly configured to identify records
- **Structure changes**: Ensure `preserveSourceStructure` is set to true in the configuration
- **Multiple processing**: If stream records are being processed multiple times, check for missing `metadata.postProcessing.consolidatedRecord` flags 