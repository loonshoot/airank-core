# consolidateOrganizations Job

## Overview
The `consolidateOrganizations` job transforms company/account records from different data sources into standardized organization records in AI Rank's unified data model. It handles duplicate detection, merging of company data, and maintains source attribution at the field level.

## How It Works
1. Processes records from source-specific `source_[sourceId]_consolidated` collection
2. **Dynamically determines the object type** from record metadata and source configuration
3. Transforms records using source-specific mapping configurations
4. Detects duplicate organizations using configurable matching rules
5. Merges data or creates new records in the `organizations` collection
6. Maintains a full audit trail of all field changes

## Configuration Requirements

### Source Config Requirements
Each source (like `salesforce`) must define:

```json
{
  "objectTypeMapping": {
    "organizations": ["Account"]  // List all object types that map to organizations
  },
  "objects": {
    "Account": {  // Must match object type name from metadata.objectType
      "primaryId": "Id",  // Field containing unique identifier
      "organizationsMapping": {  // Maps to final schema
        "companyName": "Name",  // Standard field : Source-mapped field
        "domain": "Website",
        "website": "Website",
        "externalIds": {  // Special mapping for IDs
          "salesforce": [
            {
              "id": "Id",
              "label": "Account ID",
              "type": "account"
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
2. Falls back to checking the `objectTypeMapping.organizations` list to find mapped types
3. Uses the appropriate mapping configuration for the record's actual type

This allows the system to handle different naming conventions across source systems (e.g., "Account" in Salesforce, "companies" in HubSpot).

### Workspace Configuration
The job uses workspace-specific configurations:
- `dataOrganizationsMergeIdentities`: Controls duplicate detection rules
- `dataOrganizationsCombineSources`: Controls which source takes precedence for conflicting data

## Field Mapping Types
- **Scalar fields**: Direct string mappings (`"companyName": "Name"`)
- **External IDs**: Special object structures for source-specific identifiers
- **Array fields**: For complex data types with nested structures

## Duplicate Detection
The job uses configurable rules to find matching records:
- Company name (normalized)
- Domain name (primary business identifier)
- Website URL (normalized)
- External IDs from source systems
- HubSpot IDs get special handling for better integration

## Troubleshooting
Common issues:
- **Missing organizations**: Check field mappings and object type in source config
- **Duplicate organizations**: Review merge identity rules and unique identifiers
- **Incorrect data**: Verify field mappings and source prioritization
- **Performance issues**: Check indices on companyName, domain, and externalIds fields
- **Mapping issues**: Ensure the object type in `metadata.objectType` matches a configuration in the source config

## Example Transformation
From source record:
```json
{
  "record": {
    "Id": "0018d00000abcXYZ",
    "Name": "Acme Corp",
    "Website": "https://acme.com",
    "Industry": "Technology",
    "BillingCity": "San Francisco",
    "BillingCountry": "USA"
  },
  "metadata": {
    "objectType": "Account"  // This value is used to find the right mapping
  }
}
```

To standardized organization:
```json
{
  "companyName": "Acme Corp",
  "website": "https://acme.com",
  "domain": "acme.com",
  "industry": "Technology",
  "addresses": [
    {
      "city": "San Francisco",
      "country": "USA",
      "type": "billing"
    }
  ],
  "externalIds": {
    "salesforce": [
      {
        "id": "0018d00000abcXYZ",
        "label": "Account ID",
        "type": "account"
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