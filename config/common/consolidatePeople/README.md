# consolidatePeople Job

## Overview
The `consolidatePeople` job transforms contact records from various data sources (Salesforce, HubSpot, etc.) into standardized person records in the unified data model. It performs duplicate detection, field-level merging, and maintains detailed source attribution.

## How It Works
1. Processes records from the source-specific `source_[sourceId]_consolidated` collection
2. **Dynamically determines the object type** from record metadata and source configuration
3. Transforms records using source-specific mapping rules
4. Detects duplicates using configurable matching rules
5. Merges or creates records in the `people` collection with full audit trail

## Configuration Requirements

### Source Config Requirements
Each source (like `salesforce`) must define:

```json
{
  "objectTypeMapping": {
    "people": ["Contact"]  // List all object types that map to people
  },
  "objects": {
    "Contact": {  // Must match object type name from metadata.objectType
      "primaryId": "Id",  // Field containing unique identifier
      "peopleMapping": {  // Maps to final schema
        "emailAddress": "Email",  // Standard field : Source-mapped field
        "firstName": "FirstName",
        "phoneNumbers": [  // Array fields with nested mappings
          {
            "number": "Phone",
            "phoneType": "work"
          }
        ],
        "externalIds": {  // Special mapping for IDs
          "salesforce": [
            {
              "id": "Id",
              "label": "Contact ID",
              "type": "contact"
            }
          ]
        }
      }
    }
  }
}
```

### Dynamic Object Type Resolution
The job uses the `metadata.objectType` field from the record to dynamically find the correct object configuration:

1. First attempts to find a direct match in the source config's `objects` section
2. Falls back to checking the `objectTypeMapping.people` list to find mapped types
3. Uses the appropriate mapping configuration for the record's actual type

This allows the system to handle different naming conventions across source systems (e.g., "Contact" in Salesforce, "contacts" in HubSpot).

### Workspace Configuration
The job uses workspace-specific configurations:
- `dataPeopleMergeIdentities`: Controls duplicate detection rules
- `dataPeopleCombineSources`: Controls which source takes precedence for conflicting data

## Field Mapping Types
- **Scalar fields**: Direct string mappings (`"firstName": "FirstName"`)
- **Array fields**: For phones, addresses, etc. using nested structures
- **External IDs**: Special object structures for source-specific identifiers
- **Associations**: Relationships to other entities

## Duplicate Detection
The job uses configurable rules to find matching records:
- Email address (primary identifier)
- Phone numbers (normalized)
- External IDs from source systems
- HubSpot IDs get special handling for better integration

## Troubleshooting
Common issues:
- **Missing records**: Check field mappings and object type in source config
- **Duplicate records**: Review merge identity rules and unique identifiers
- **Incorrect data**: Verify field mappings and source prioritization
- **Performance issues**: Check indices on emailAddress and externalIds fields
- **Mapping issues**: Ensure the object type in `metadata.objectType` matches a configuration in the source config

## Example Transformation
From source record:
```json
{
  "record": {
    "Id": "0038d00000abcDEF",
    "Email": "john@example.com",
    "FirstName": "John",
    "LastName": "Doe",
    "Phone": "555-123-4567",
    "Title": "CEO"
  },
  "metadata": {
    "objectType": "Contact"  // This value is used to find the right mapping
  }
}
```

To standardized person:
```json
{
  "emailAddress": "john@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "phoneNumbers": [
    {
      "number": "555-123-4567",
      "phoneType": "work"
    }
  ],
  "jobTitle": "CEO",
  "externalIds": {
    "salesforce": [
      {
        "id": "0038d00000abcDEF",
        "label": "Contact ID",
        "type": "contact"
      }
    ]
  },
  "metadata": {
    "sourceId": "sourceId",
    "sourceType": "salesforce",
    "lastSourceType": "salesforce"
  }
}
```