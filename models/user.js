const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  telegramId: { type: String, required: true, unique: true },
  username: String,
  fullName: String,
  registeredAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('User', userSchema);
