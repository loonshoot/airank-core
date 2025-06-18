# consolidateFacts Job

## Overview
The `consolidateFacts` job transforms fact/metric records from different data sources into standardized fact records in the unified data model. Facts are numerical or categorical data points associated with entities, like revenue for a company or engagement metrics for a contact.

## How It Works
1. Processes fact records from source-specific `source_[sourceId]_consolidated` collection
2. Transforms records using source-specific mapping configurations
3. Detects duplicate facts using entity ID, fact type, date range, and dimensions
4. Merges or creates records in the `facts` collection with source attribution
5. Maintains a full audit trail of all changes

## Configuration Requirements

### Source Config Requirements
Each source (like `salesforce` or `hubspot`) must define:

```json
{
  "objectTypeMapping": {
    "facts": ["Metric", "Statistic"]  // List object types that contain fact data
  },
  "objects": {
    "Metric": {  // Must match object type name
      "primaryId": "id",  // Field containing unique identifier
      "factsMapping": {  // Maps to final schema
        "factType": "metricType",  // Standard field : Source-mapped field
        "property": "property",
        "value": "value",
        "entityId": "entityId",
        "entityType": "entityType",
        "period": "period",
        "dateRange": {  // Date range object mapping
          "from": "startDate",
          "to": "endDate"
        },
        "dimensions": "dimensions",  // Additional dimensions for slicing
        "externalIds": {  // Special mapping for IDs
          "salesforce": [
            {
              "id": "id",
              "label": "Metric ID",
              "type": "metric"
            }
          ]
        }
      }
    }
  }
}
```

### Special Merging Rules
Facts have specific rules for duplicate detection:
- Records with the same `factType`, `entityId`, `period`, `dateRange` (with overlap), and identical `dimensions` are considered duplicates
- Newer facts from the same source will update existing ones
- Facts from higher-priority sources will override lower-priority sources

## Fact Types and Structure
Facts have a standard structure with:
- **factType**: Category of the fact (revenue, engagement, etc.)
- **property**: Specific property being measured
- **value**: The actual numerical or categorical value
- **entityId**: ID of the associated entity (person, organization)
- **entityType**: Type of the associated entity
- **period**: Time period of measurement (daily, monthly, quarterly, etc.)
- **dateRange**: Specific date range for the measurement
- **dimensions**: Additional facets for the fact (e.g., channel, campaign, region)

## Example Transformation
From source record (in consolidated collection):
```json
{
  "record": {
    "Id": "00FT000000abcXYZ",
    "MetricType": "revenue",
    "Property": "mrr",
    "Value": 5000,
    "AccountId": "0018d00000abcXYZ",
    "Period": "monthly",
    "StartDate": "2023-01-01",
    "EndDate": "2023-01-31",
    "Dimensions": {
      "product": "enterprise",
      "region": "west"
    }
  },
  "metadata": {
    "objectType": "Metric"
  }
}
```

To standardized fact:
```json
{
  "factType": "revenue",
  "property": "mrr",
  "value": 5000,
  "entityId": "0018d00000abcXYZ",
  "entityType": "organization",
  "period": "monthly",
  "dateRange": {
    "from": "2023-01-01",
    "to": "2023-01-31"
  },
  "dimensions": {
    "product": "enterprise",
    "region": "west"
  },
  "externalIds": {
    "salesforce": [
      {
        "id": "00FT000000abcXYZ",
        "label": "Metric ID",
        "type": "metric"
      }
    ]
  },
  "metadata": {
    "sourceId": "sourceId",
    "sourceType": "salesforce",
    "lastSourceType": "salesforce",
    "fieldMetadata": {
      "value": {
        "sourceId": "sourceId",
        "sourceType": "salesforce",
        "updatedAt": "2023-04-20T15:30:45.123Z"
      }
    }
  }
}
```

## Troubleshooting
Common issues:
- **Missing facts**: Check field mappings and that object types are correctly defined in the source config
- **Duplicate facts**: Review date range handling and dimension comparison logic
- **Value overrides**: Check source priority settings if fact values from one source are unexpectedly overriding another
- **Date range issues**: Ensure date formats are consistent and parseable 