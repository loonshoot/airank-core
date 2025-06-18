
function validateAndAdd(field, input, cleanedData, res) {
    const { name, type, validation } = field;
  
    if (input[name] !== undefined && input[name] !== null) {
      const value = input[name];
  
      try {
        switch (type) {
          case 'String':
            cleanedData[name] = validation === 'html' ? sanitizeHtml(value, {
              allowedTags: ['p', 'br', 'strong', 'em'],
              allowedAttributes: { 'p': ['style'], 'br': [], 'strong': [], 'em': [] }
            }) : value;
            break;
          case 'Integer':
            if (!Number.isInteger(value)) {
              res.status(400).json({ error: `${name} must be an integer` });
              return false;
            }
            cleanedData[name] = value;
            break;
          case 'Double':
            if (typeof value !== 'number' || Number.isNaN(value)) {
              res.status(400).json({ error: `${name} must be a double` });
              return false;
            }
            cleanedData[name] = value;
            break;
          case 'Boolean':
            if (typeof value !== 'boolean') {
              res.status(400).json({ error: `${name} must be a boolean` });
              return false;
            }
            cleanedData[name] = value;
            break;
          case 'Date':
            if (!isValidDate(value)) {
              res.status(400).json({ error: `${name} must be a valid date` });
              return false;
            }
            cleanedData[name] = new Date(value);
            break;
          case 'Array':
            if (!Array.isArray(value)) {
              res.status(400).json({ error: `${name} must be an array` });
              return false;
            }
            cleanedData[name] = value;
            break;
          case 'Object':
            if (typeof value !== 'object' || Array.isArray(value)) {
              res.status(400).json({ error: `${name} must be an object` });
              return false;
            }
            cleanedData[name] = value;
            break;
          case 'ObjectId':
            if (!mongoose.Types.ObjectId.isValid(value)) {
              res.status(400).json({ error: `${name} must be a valid ObjectId` });
              return false;
            }
            cleanedData[name] = value;
            break;
          case 'Binary':
            if (!(value instanceof Buffer)) {
              res.status(400).json({ error: `${name} must be binary data` });
              return false;
            }
            cleanedData[name] = value;
            break;
          case 'Timestamp':
            if (!(value instanceof Date) || isNaN(value.getTime())) {
              res.status(400).json({ error: `${name} must be a valid timestamp` });
              return false;
            }
            cleanedData[name] = value;
            break;
          case 'RegExp':
            if (!(value instanceof RegExp)) {
              res.status(400).json({ error: `${name} must be a regular expression` });
              return false;
            }
            cleanedData[name] = value;
            break;
          case 'Decimal128':
            if (typeof value !== 'object' || !value.constructor || value.constructor.name !== 'Decimal128') {
              res.status(400).json({ error: `${name} must be a Decimal128` });
              return false;
            }
            cleanedData[name] = value;
            break;
          case 'MinKey':
            if (value !== mongoose.MinKey) {
              res.status(400).json({ error: `${name} must be a MinKey` });
              return false;
            }
            cleanedData[name] = value;
            break;
          case 'MaxKey':
            if (value !== mongoose.MaxKey) {
              res.status(400).json({ error: `${name} must be a MaxKey` });
              return false;
            }
            cleanedData[name] = value;
            break;
          default:
            res.status(400).json({ error: `Unsupported data type: ${type}` });
            return false;
        }
      } catch (e) {
        res.status(400).json({ error: `Error processing field ${name}: ${e.message}` });
        return false;
      }
    }
    return true;
  }
  
  function isValidDate(date) {
    return !isNaN(Date.parse(date));
  }