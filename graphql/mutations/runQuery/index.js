const { Member } = require('../../queries/member');
const mongoose = require('mongoose');

// Explicitly define allowed MongoDB operations and their parameters
const ALLOWED_OPERATIONS = {
  // Database operations
  db: true,
  collection: true,
  // Find operations
  find: true,
  findOne: true,
  // Aggregation
  aggregate: true,
  // Count operations
  count: true,
  countDocuments: true,
  estimatedDocumentCount: true,
  // Distinct values
  distinct: true,
  // Cursor operations
  limit: true,
  skip: true,
  sort: true,
  project: true,
  // Array operations
  toArray: true
};

// Function to validate query is read-only
function validateQuery(queryString) {
  // Split the query into its component operations
  const operations = queryString
    .split('.')
    .map(op => op.trim())
    .filter(op => op)
    .map(op => {
      // Extract operation name without parameters
      const match = op.match(/^([a-zA-Z]+)/);
      return match ? match[1] : null;
    })
    .filter(op => op);

  // Check if all operations are allowed
  const invalidOps = operations.filter(op => !ALLOWED_OPERATIONS[op]);
  
  if (invalidOps.length > 0) {
    throw new Error(`Invalid operations detected: ${invalidOps.join(', ')}. Only the following operations are allowed: ${Object.keys(ALLOWED_OPERATIONS).join(', ')}`);
  }

  // Ensure query starts with a primary operation
  const primaryOperations = ['db', 'find', 'findOne', 'aggregate', 'count', 'countDocuments', 'estimatedDocumentCount', 'distinct'];
  if (!primaryOperations.includes(operations[0])) {
    throw new Error(`Query must start with one of these operations: ${primaryOperations.join(', ')}`);
  }

  return true;
}

async function runQuery(parent, args, { user }) {
  if (user && (user.sub)) {
    try {
      const member = await Member.findOne({
        workspaceId: args.workspaceId,
        email: user.email,
        permissions: "mutation:runQuery"
      });

      if (member) {
        if (!args.query) {
          throw new Error('Missing required field: query');
        }

        // Validate query is read-only
        validateQuery(args.query);

        // Connect to workspace database
        const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${args.workspaceId}?${process.env.MONGODB_PARAMS}`;
        const datalake = mongoose.createConnection(dataLakeUri);
        await datalake.asPromise();

        try {
          // Execute the query with db context
          const queryFunc = new Function('db', `return ${args.query}`);
          const results = await queryFunc(datalake);

          // Convert cursor to array if needed
          const finalResults = results.toArray ? await results.toArray() : results;

          await datalake.close();
          return {
            results: finalResults,
            count: Array.isArray(finalResults) ? finalResults.length : 1
          };
        } catch (error) {
          throw new Error(`Query execution failed: ${error.message}`);
        } finally {
          await datalake.close();
        }
      } else {
        console.error('User not authorized to run queries');
        return null;
      }
    } catch (error) {
      console.error('Error running query:', error);
      throw error;
    }
  } else {
    console.error('User not authenticated');
    return null;
  }
}

module.exports = { runQuery }; 