# Relationship Data Flow Diagram

```
┌───────────────────┐                  ┌──────────────────┐              ┌──────────────────┐
│                   │                  │                  │              │                  │
│    Data Source    │                  │ Source-Specific  │              │                  │
│    (HubSpot)      │───Stream Data───▶│ Stream           │──Processed──▶│  Relationships   │
│                   │                  │ Collection       │              │  Collection      │
└───────────────────┘                  └──────────────────┘              └──────────────────┘
                                        source_{id}_stream               relationships
                                        
┌───────────────────┐                  ┌──────────────────┐              
│                   │                  │                  │              
│    Data Source    │                  │ Source-Specific  │              
│    (Custom API)   │───Stream Data───▶│ Stream           │──────────────▶
│                   │                  │ Collection       │              
└───────────────────┘                  └──────────────────┘              
                                        source_{id}_stream               
```

## Processing Flow

1. **Data Extraction (Integrated in Batch Job)**
   ```
   HubSpot Batch Job ─── Step 6: Process Relationships ──▶ source_{id}_stream (objectType: relationship)
   ```

2. **Consolidation**
   ```
   Listener ─── source_{id}_stream ──▶ consolidateRelationships job ──▶ relationships collection
   ```

3. **Query Access**
   ```
   Application ─── query ──▶ relationships ──▶ UI display
   ```

## Relationship Entity Structure

```
┌───────────────┐          ┌────────────────────┐
│               │          │                    │
│    Person     │◄─────────┤    Relationship    │─────────┐
│               │          │                    │         │
└───────────────┘          └────────────────────┘         │
                                                          │
┌───────────────┐          ┌────────────────────┐         │
│               │          │                    │         │
│  Organization │◄─────────┤    Relationship    │◄────────┘
│               │          │                    │
└───────────────┘          └────────────────────┘
```

## Canonical Relationship Direction

```
High Priority                                                       Low Priority
┌───────────────┐          ┌───────────────┐          ┌───────────────┐
│               │          │               │          │               │
│ Organization  │───────▶  │    Person     │───────▶  │     Deal      │
│               │          │               │          │               │
└───────────────┘          └───────────────┘          └───────────────┘
```

Relationships are always stored with the higher-priority entity as the source.

## Integration with Existing Architecture

```
                      ┌─────────────────┐
                      │                 │
                      │  HubSpot Batch  │
                      │      Job        │
                      │                 │
                      └────────┬────────┘
                               │
                               ▼
┌──────────────┐      ┌─────────────────┐
│              │      │                 │
│   Objects    │◀─────┤  Process Step 3 │
│              │      │                 │
└──────────────┘      └─────────────────┘
                               │
                               ▼
┌──────────────┐      ┌─────────────────┐
│              │      │                 │
│    Events    │◀─────┤  Process Step 5 │
│              │      │                 │
└──────────────┘      └─────────────────┘
                               │
                               ▼
┌──────────────┐      ┌─────────────────┐
│              │      │                 │
│Relationships │◀─────┤  Process Step 6 │
│              │      │                 │
└──────────────┘      └─────────────────┘
``` 