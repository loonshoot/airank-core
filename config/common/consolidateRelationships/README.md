# consolidateRelationships Job

## Overview
The `consolidateRelationships` job processes relationship records from various data sources (such as contact-to-account in Salesforce or contact-to-company in HubSpot) and transforms them into standardized relationship records in AI Rank's unified data model. It handles canonicalization, entity enrichment, and maintains relationship direction consistency.

## How It Works
1. Processes relationship records from `source_[sourceId]_consolidated` collection
2. **Dynamically determines the object type** from record metadata and source configuration
3. Canonicalizes relationships to ensure consistent direction
4. Enriches relationships with entity display names and IDs
5. Detects duplicate relationships using configurable matching rules
6. Merges or creates standardized records in the `relationships` collection

## Configuration Requirements

### Source Config Requirements
Each source (like `salesforce`) must define:

```json
{
  "objectTypeMapping": {
    "relationship": ["ContactAccountRelationship", "ContactOpportunityRelationship"]  // All relationship object types
  },
  "objects": {
    "ContactAccountRelationship": {  // Must match object type name from metadata.objectType
      "primaryId": "Id",
      "entityA": {  // Source entity definition
        "type": "person",  // Must be one of: person, organization, deal, event
        "idField": "source.id"  // Field containing the entity ID
      },
      "entityB": {  // Target entity definition
        "type": "organization",  // Must be one of: person, organization, deal, event
        "idField": "target.id"  // Field containing the entity ID
      },
      "relationshipMapping": {  // Maps to final schema
        "relationshipType": "relationshipType",  // String defining the relationship type
        "attributes": {  // Additional descriptive attributes
          "title": "attributes.title",
          "department": "attributes.department"
        }
      }
    }
  }
}
```

### Dynamic Object Type Resolution
The job uses the `metadata.objectType` field from the record to dynamically find the correct object configuration:

1. First attempts to find a direct match in the source config's `objects` section
2. Falls back to checking the `objectTypeMapping.relationship` list to find mapped types
3. Uses the appropriate mapping configuration for the record's actual type

This allows the system to handle different naming conventions across source systems (e.g., "ContactAccountRelationship" in Salesforce, "company_contacts" in HubSpot).

### Entity Type Priorities
The consolidation config defines entity type priorities to ensure consistent relationship direction:

```json
{
  "entityTypePriority": {
    "person": 10,
    "organization": 20,
    "deal": 30,
    "event": 40
  }
}
```

Lower numbers have higher priority. Relationships are canonicalized so that the entity with higher priority (lower number) is always the "source" entity.

### Workspace Configuration
The job uses workspace-specific configurations:
- `dataRelationshipsMergeIdentities`: Controls duplicate detection rules
- `dataRelationshipsCombineSources`: Controls which source takes precedence for conflicting data

## Relationship Types
Common relationship types include:
- `employment`: Person works at Organization
- `ownership`: Organization owns another entity 
- `parent/child`: Parent-child relationship between same entity types
- `participation`: Person participates in a Deal/Event

## Troubleshooting
Common issues:
- **Missing relationships**: Check object type mapping and field mappings
- **Duplicate relationships**: Review merge identity rules
- **Entity reference issues**: Ensure entity IDs are properly mapped and entity types are correct
- **Direction inconsistency**: Check entity type priorities
- **Mapping issues**: Ensure the object type in `metadata.objectType` matches a configuration in the source config

## Example Transformation
From source record:
```json
{
  "record": {
    "Id": "00NT000000abcDEF",
    "source": {
      "id": "0038d00000abcDEF",
      "type": "person" 
    },
    "target": {
      "id": "0018d00000abcXYZ",
      "type": "organization"
    },
    "relationshipType": "employment",
    "attributes": {
      "title": "CEO",
      "department": "Executive"
    }
  },
  "metadata": {
    "objectType": "ContactAccountRelationship"  // This value is used to find the right mapping
  }
}
```

To standardized relationship:
```json
{
  "source": {
    "id": "5f8a7b9c3d2e1f0a9b8c7d6e", // MongoDB ID of person
    "type": "person",
    "displayName": "John Doe",
    "externalId": "0038d00000abcDEF"
  },
  "target": {
    "id": "1a2b3c4d5e6f7g8h9i0j1k2l", // MongoDB ID of organization
    "type": "organization",
    "displayName": "Acme Corp",
    "externalId": "0018d00000abcXYZ"
  },
  "relationshipType": "employment",
  "attributes": {
    "title": "CEO",
    "department": "Executive"
  },
  "externalIds": {
    "salesforce": [
      {
        "id": "00NT000000abcDEF",
        "label": "Relationship ID",
        "type": "relationship"
      }
    ]
  },
  "metadata": {
    "sourceId": "sourceId",
    "sourceType": "salesforce"
  }
}
```

## Entity Enrichment
The job also enriches relationships with display names and canonical entity IDs by querying the people and organizations collections to find matching entities based on external IDs. This helps maintain referential integrity in the data model.

## Canonical Relationship Direction
Relationships are stored with consistent direction:
- If entityA is higher priority than entityB, store as-is
- If entityB is higher priority, swap source/target and adjust relationshipType
- Example: "ownership" becomes "owned_by" when reversed 