const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  price: { type: Number, required: true },
  discount: { type: Number, default: 0 }, // Percentage discount
  imageUrl: String,
  category: String,
});

module.exports = mongoose.model('Product', productSchema);
