const mongoose = require('mongoose');

const inputsSchema = new mongoose.Schema({
  name: String,
  type: String,
  validation: String
});

module.exports = { inputsSchema }; 