# Confluence V1 Batch Job

## Overview

The Confluence V1 batch job is responsible for extracting content data from Confluence sites, including pages, blog posts, and their relationships with spaces. It follows a stream-based architecture where all data is written to a source-specific stream collection before consolidation.

## Key Features

- Incremental data extraction based on modification dates
- Rate-limited API access using Redis
- Support for multiple content types (pages, blog posts)
- Space-content relationship extraction
- Error handling with automatic retries

## Content Types

The connector extracts the following content types:
- Pages
- Blog posts

## Data Model

### Content Structure
Each content item is stored with the following structure:
```javascript
{
  record: {
    // Original Confluence content data
    id: "content_id",
    type: "page|blogpost",
    title: "Content title",
    space: { ... },
    body: { ... },
    version: { ... },
    // ... other Confluence content fields
  },
  metadata: {
    sourceId: "source_instance_id",
    objectType: "page|blogpost",
    sourceType: "confluence",
    createdAt: Date,
    updatedAt: Date,
    jobHistoryId: "job_id"
  }
}
```

### Relationship Structure
Relationships between content and spaces are stored with the following structure:
```javascript
{
  record: {
    id: "relationship_id",
    source: {
      id: "content_id",
      type: "document",
      externalId: "content_id"
    },
    target: {
      id: "space_id",
      type: "space",
      externalId: "space_id"
    },
    relationshipType: "belongsTo",
    attributes: {
      spaceKey: "SPACEKEY",
      spaceType: "global|personal"
    }
  },
  metadata: {
    sourceId: "source_instance_id",
    objectType: "relationship",
    relationshipType: "documentSpaceRelationship",
    sourceEntityType: "page|blogpost",
    targetEntityType: "space",
    sourceType: "confluence",
    createdAt: Date,
    updatedAt: Date,
    jobHistoryId: "job_id"
  }
}
```

## Workflow

1. **Authentication**
   - Uses OAuth 2.0 for Atlassian API access
   - Manages token refreshing when expired
   - Handles rate limiting to prevent API throttling

2. **Data Extraction Process**
   - Fetches spaces list from Confluence instance
   - Downloads content items (pages, blog posts) using the Confluence Content Search API
   - Applies incremental updates based on modification dates
   - Processes space-content relationships
   - Writes all data to stream collection in MongoDB

3. **Error Handling**
   - Automatic retries for transient failures
   - Detailed error logging
   - Comprehensive job history records

## Usage

The connector is typically scheduled to run hourly and processes:
1. All content for new sources (backfill)
2. Modified content since last successful run (incremental)

## Configuration

The connector is configured in `config.json` with the following settings:
- Rate limits for API calls
- Content type mappings
- Field mappings for content types
- Relationship definitions

## Dependencies

- MongoDB for data storage
- Redis for rate limiting
- Atlassian Confluence REST API access
- Valid OAuth tokens with appropriate scopes

## Required OAuth Scopes

The following scopes are required for the connector to function properly:
- `read:confluence-content.all`: to access all content
- `read:confluence-space.summary`: to access space information
- `read:confluence-user`: to access user information
- `offline_access`: to enable refresh tokens

## Integration Points

- **Stream Collection**: `source_{id}_stream`
- **Job History**: Tracks data extraction progress
- **Rate Limiting**: Uses Redis for API quota management
- **Consolidation**: Feeds into content consolidation jobs

## Monitoring

- Job history records in MongoDB
- Error logs with detailed API response information
- Rate limiting statistics in Redis
- Stream collection metrics 