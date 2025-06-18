type DateRange {
  from: DateTime!
  to: DateTime!
}

type FactLocation {
  country: String
  region: String
  city: String
}

type Fact {
  _id: ID!
  factType: String!
  property: String!
  entityId: String!
  entityType: String!
  value: Float!
  dateRange: DateRange!
  location: FactLocation
  dimensions: JSON
  period: String!
  source: String!
  metadata: Metadata
  createdAt: DateTime
  updatedAt: DateTime
}

input FactLocationInput {
  country: String
  region: String
  city: String
}

input DateRangeInput {
  from: DateTime!
  to: DateTime!
} 