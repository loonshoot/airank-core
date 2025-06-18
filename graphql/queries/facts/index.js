const { gql } = require('apollo-server-express');
const mongoose = require('mongoose');
const { ConsolidatedRecordSchema } = require('../../../config/data/models');
const { Member } = require('../member');
require('dotenv').config();

// Helper function to create a connection to a workspace
async function createConnection(workspaceId) {
  if (!workspaceId) {
    throw new Error('Workspace ID is required');
  }

  const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
  return mongoose.createConnection(dataLakeUri).asPromise();
}

// Fact finder function
async function findFacts(args, workspaceId) {
  try {
    const {
      property,
      entityId,
      entityType,
      factType,
      startDate,
      endDate,
      period,
      location,
      dimensions,
      limit = 100,
      offset = 0
    } = args;

    // Create connection to the workspace
    let connection;
    try {
      connection = await createConnection(workspaceId);
    } catch (connectionError) {
      console.error('Error connecting to workspace database:', connectionError);
      throw new Error('Failed to connect to workspace database');
    }
    
    // Build query
    const query = {};
    
    if (property) query.property = property;
    if (entityId) query.entityId = entityId;
    if (entityType) query.entityType = entityType;
    if (factType) query.factType = factType;
    if (period) query.period = period;
    
    // Date range filtering
    if (startDate || endDate) {
      query.dateRange = {};
      if (startDate) query['dateRange.from'] = { $gte: new Date(startDate) };
      if (endDate) query['dateRange.to'] = { $lte: new Date(endDate) };
    }
    
    // Location filtering
    if (location) {
      if (location.country) query['location.country'] = location.country;
      if (location.region) query['location.region'] = location.region;
      if (location.city) query['location.city'] = location.city;
    }
    
    // Dimension filtering
    if (dimensions && Object.keys(dimensions).length > 0) {
      Object.entries(dimensions).forEach(([key, value]) => {
        query[`dimensions.${key}`] = value;
      });
    }
    
    // Execute query
    let results = [];
    try {
      const Facts = connection.model('facts', ConsolidatedRecordSchema);
      results = await Facts.find(query)
        .sort({ 'dateRange.from': -1 })
        .limit(limit)
        .skip(offset)
        .exec();
    } catch (queryError) {
      console.error('Error querying facts:', queryError);
      throw new Error('Failed to query facts collection');
    } finally {
      // Close connection
      if (connection) {
        try {
          await connection.close();
        } catch (closeError) {
          console.error('Error closing connection:', closeError);
        }
      }
    }
    
    return results;
  } catch (error) {
    console.error('Error finding facts:', error);
    throw error;
  }
}

// Facts aggregation function
async function aggregateFacts(args, workspaceId) {
  try {
    const {
      property,
      factType,
      startDate,
      endDate,
      groupBy,
      filters = {}
    } = args;
    
    // Create connection to the workspace
    let connection;
    try {
      connection = await createConnection(workspaceId);
    } catch (connectionError) {
      console.error('Error connecting to workspace database:', connectionError);
      throw new Error('Failed to connect to workspace database');
    }
    
    // Build match stage
    const match = {
      property,
      factType
    };
    
    // Date range filtering
    if (startDate) match['dateRange.from'] = { $gte: new Date(startDate) };
    if (endDate) match['dateRange.to'] = { $lte: new Date(endDate) };
    
    // Add any additional filters
    Object.entries(filters).forEach(([key, value]) => {
      match[key] = value;
    });
    
    // Build group stage
    const groupStage = { _id: {} };
    
    // Time-based grouping
    if (groupBy === 'day') {
      groupStage._id.year = { $year: '$dateRange.from' };
      groupStage._id.month = { $month: '$dateRange.from' };
      groupStage._id.day = { $dayOfMonth: '$dateRange.from' };
    } else if (groupBy === 'week') {
      groupStage._id.year = { $year: '$dateRange.from' };
      groupStage._id.week = { $week: '$dateRange.from' };
    } else if (groupBy === 'month') {
      groupStage._id.year = { $year: '$dateRange.from' };
      groupStage._id.month = { $month: '$dateRange.from' };
    } else if (groupBy === 'country') {
      groupStage._id.country = '$location.country';
    } else if (groupBy === 'device') {
      groupStage._id.device = '$dimensions.device';
    } else {
      // Default to grouping by the specific dimension
      groupStage._id[groupBy] = `$dimensions.${groupBy}`;
    }
    
    // Add aggregation metrics
    groupStage.total = { $sum: '$value' };
    groupStage.average = { $avg: '$value' };
    groupStage.min = { $min: '$value' };
    groupStage.max = { $max: '$value' };
    groupStage.count = { $sum: 1 };
    
    let results = [];
    try {
      // Execute aggregation
      const Facts = connection.model('facts', ConsolidatedRecordSchema);
      results = await Facts.aggregate([
        { $match: match },
        { $group: groupStage },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1, '_id.week': 1 } }
      ]).toArray();
    } catch (aggregateError) {
      console.error('Error aggregating facts:', aggregateError);
      throw new Error('Failed to aggregate facts collection');
    } finally {
      // Close connection
      if (connection) {
        try {
          await connection.close();
        } catch (closeError) {
          console.error('Error closing connection:', closeError);
        }
      }
    }
    
    return results;
  } catch (error) {
    console.error('Error aggregating facts:', error);
    throw error;
  }
}

// Define the typeDefs (schema)
const typeDefs = gql`
  scalar DateTime
  scalar JSON
  
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
    metadata: JSON
    externalIds: JSON
    createdAt: DateTime
    updatedAt: DateTime
  }
  
  type FactAggregate {
    _id: JSON
    total: Float
    average: Float
    min: Float
    max: Float
    count: Int
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
  
  extend type Query {
    facts(
      property: String
      entityId: String
      entityType: String
      factType: String
      startDate: DateTime
      endDate: DateTime
      period: String
      location: FactLocationInput
      dimensions: JSON
      limit: Int = 100
      offset: Int = 0
    ): [Fact]
    
    factsAggregate(
      property: String!
      factType: String!
      startDate: DateTime!
      endDate: DateTime!
      groupBy: String!
      filters: JSON
    ): [FactAggregate]
  }
`;

// Define the resolvers
const resolvers = {
  Query: {
    facts: async (_, args, { workspaceId, user }) => {
      if (user && user.sub) {
        const member = await Member.findOne({ 
          workspaceId, 
          userId: user.sub,
          permissions: "query:facts" 
        });

        if (member) {
          return findFacts(args, workspaceId);
        } else {
          console.error('User not authorized to query facts');
          return null;
        }
      } else {
        console.error('User not authenticated');
        return null;
      }
    },
    factsAggregate: async (_, args, { workspaceId, user }) => {
      if (user && user.sub) {
        const member = await Member.findOne({ 
          workspaceId, 
          userId: user.sub,
          permissions: "query:facts" 
        });

        if (member) {
          return aggregateFacts(args, workspaceId);
        } else {
          console.error('User not authorized to query facts aggregate');
          return null;
        }
      } else {
        console.error('User not authenticated');
        return null;
      }
    }
  }
};

module.exports = { typeDefs, resolvers }; 