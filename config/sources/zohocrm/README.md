# Zoho CRM Integration

## Overview

This configuration enables Outrun to integrate with Zoho CRM, providing bidirectional sync capabilities for people, organizations, and relationships. Zoho CRM has a unique data structure that differs significantly from other CRM systems like Salesforce and HubSpot.

## Key Differences from Other CRMs

### Relationship Handling

Unlike Salesforce and HubSpot, **Zoho CRM does not expose explicit relationship objects** through its API. Instead, relationships are handled through:

1. **Lookup Fields**: Direct references on records (e.g., `Account_Name.id` on Contacts)
2. **Activity Objects**: Tasks, Notes, Events, Calls with `What_Id`/`Who_Id` references
3. **Related Lists**: Implicit relationships through parent-child structures

### Our Approach: Lookup Field Extraction

Since Zoho doesn't provide standard relationship objects, we implement **synthetic relationship creation** by:

1. **Extracting lookup field data** from primary objects (Contacts, Accounts, Leads)
2. **Creating standardized relationship records** that match our common relationship schema
3. **Mapping implicit relationships** to explicit relationship types

## Supported Object Types

### Primary Objects
- **Leads** → `people` (prospects/potential customers)
- **Contacts** → `people` (established contacts)  
- **Accounts** → `organizations` (companies/accounts)

### Synthetic Relationships
- **ContactOrganizationRelationship** → `people_to_organization` (Contact.Account_Name lookup)
- **ContactContactRelationship** → `people_to_people` (Contact.Reporting_To lookup)
- **OrganizationOrganizationRelationship** → `organization_to_organization` (Account.Parent_Account lookup)
- **OrganizationContactRelationship** → `organization_to_people` (Account → Contacts via Related Records API)

## Configuration Structure

### Object Mapping (`objects` section)

Each Zoho object has three mapping types:

1. **`attributeMapping`**: Legacy field-to-field mapping
2. **`peopleMapping`/`organizationsMapping`**: Structured mapping for consolidation
3. **`relationshipMapping`**: For activity objects (Tasks, Notes, etc.)

### Destination Mapping (`destinationMapping` section)

Defines how consolidated records map back to Zoho fields for write operations:

- **`people`** → Contacts or Leads
- **`organizations`** → Accounts

### Rate Limiting

Zoho has specific rate limits by operation type:
- **Read Operations**: 100 requests/minute
- **Write Operations**: 25 requests/minute  
- **Search Operations**: 50 requests/minute
- **Bulk Operations**: 10-20 requests/minute

## Relationship Extraction Logic

### How It Works

1. **During Consolidation**: Extract lookup field values from primary objects
2. **Fetch Related Records**: For Account records, call Zoho's Related Records API to get associated Contacts
3. **Create Synthetic Records**: Generate relationship objects that don't exist in Zoho's API
4. **Standard Processing**: Process synthetic relationships through normal consolidation pipeline

### Example: Contact → Account Relationship

```javascript
// Zoho Contact Record
{
  "id": "123456789",
  "First_Name": "John",
  "Last_Name": "Doe", 
  "Email": "john@example.com",
  "Account_Name": {
    "name": "Acme Corp",
    "id": "987654321"
  }
}

// Extracted Synthetic Relationship
{
  "objectType": "ContactOrganizationRelationship",
  "source": {
    "type": "person",
    "externalId": "123456789",
    "displayName": "John Doe"
  },
  "target": {
    "type": "organization", 
    "externalId": "987654321",
    "displayName": "Acme Corp"
  },
  "relationshipType": "people_to_organization"
}
```

### Implementation Details

The relationship extraction happens in multiple phases:

1. **Lookup Extraction**: Parse lookup fields (`Account_Name`, `Reporting_To`, `Parent_Account`) during object processing
2. **Related Records Fetch**: For Account records, call Zoho's Related Records API (`GET /Accounts/{id}/Contacts`) to get associated contacts
3. **Synthetic Creation**: Generate standardized relationship objects for both lookup-based and API-fetched relationships
4. **Injection Phase**: Insert synthetic relationship objects into consolidation pipeline

This allows us to maintain the same relationship processing logic across all CRM systems while accommodating Zoho's unique structure.

## Field Mappings

### People (Contacts/Leads)

| Consolidated Field | Zoho Contact | Zoho Lead |
|-------------------|--------------|-----------|
| `emailAddress` | `Email` | `Email` |
| `firstName` | `First_Name` | `First_Name` |
| `lastName` | `Last_Name` | `Last_Name` |
| `phoneNumbers[].number` | `Phone`, `Mobile` | `Phone`, `Mobile` |
| `addresses[].street` | `Mailing_Street` | `Street` |
| `associations[].id` | `Account_Name.id` | `Company` |

### Organizations (Accounts)

| Consolidated Field | Zoho Account |
|-------------------|--------------|
| `companyName` | `Account_Name` |
| `domain` | `Website` |
| `website` | `Website` |
| `phoneNumbers[].number` | `Phone`, `Fax` |
| `addresses[].street` | `Billing_Street`, `Shipping_Street` |

## Authentication

Zoho uses OAuth 2.0 with region-specific domains:

- **US**: `accounts.zoho.com` → `www.zohoapis.com`
- **EU**: `accounts.zoho.eu` → `www.zohoapis.eu`  
- **India**: `accounts.zoho.in` → `www.zohoapis.in`
- **Australia**: `accounts.zoho.com.au` → `www.zohoapis.com.au`

The integration automatically handles domain detection and API endpoint resolution.

## Data Flow

```
Zoho CRM → Stream → Consolidation → Relationship Extraction → Final Collections
    ↓           ↓           ↓                ↓                      ↓
  Raw API    Enhanced    Standardized    Synthetic           people/
  Objects    Records     Records         Relationships       organizations/
                                                            relationships
```

## Limitations

1. **No Real-time Relationships**: Zoho doesn't provide webhook events for relationship changes
2. **API Rate Limits**: Related Records API calls are subject to Zoho's rate limiting (100 requests/minute)
3. **No Bidirectional Sync**: Relationship changes in Outrun don't sync back to Zoho lookups
4. **Region Dependency**: API endpoints vary by Zoho region/data center
5. **Additional API Calls**: Account processing requires extra API calls to fetch related contacts

## Configuration Files

- **`config.json`**: Main configuration with object mappings and rate limits
- **`zohocrmDestination.js`**: Destination job for pushing data back to Zoho
- **`relationshipExtractor.js`**: Logic for extracting synthetic relationships from lookup fields
- **`README.md`**: This documentation

## Future Enhancements

1. **Activity Relationships**: Re-enable Tasks, Notes, Events as relationship sources
2. **Complex Hierarchies**: Handle multi-level Contact/Account relationships  
3. **Custom Objects**: Support for Zoho custom modules
4. **Real-time Sync**: Implement webhook-based change detection 