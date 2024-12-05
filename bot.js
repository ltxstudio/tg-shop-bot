const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const User = require('./models/user');
const Product = require('./models/product');
const Order = require('./models/order');
const CryptoBot = require('crypto-bot-api');
require('dotenv').config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const cryptoBot = new CryptoBot(process.env.CRYPTO_PAY_API_KEY);

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log(err));

// Middleware: Register user
bot.use(async (ctx, next) => {
  const telegramId = ctx.from.id.toString();
  let user = await User.findOne({ telegramId });

  if (!user) {
    user = new User({
      telegramId,
      username: ctx.from.username || 'N/A',
      fullName: `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim(),
    });
    await user.save();
    ctx.reply('Welcome to the shop! You are now registered.');
  }

  ctx.state.user = user;
  return next();
});

// Start Command
bot.start((ctx) => {
  ctx.reply(
    'Welcome to our shop bot! Use the menu below to explore.',
    Markup.keyboard([
      ['🛍️ Products', '📦 My Orders'],
      ['👤 Profile', '📞 Contact Support'],
    ]).resize()
  );
});

// View Profile
bot.command('profile', async (ctx) => {
  const user = ctx.state.user;
  ctx.reply(`Your Profile:\n\nName: ${user.fullName}\nUsername: ${user.username}\nRegistered At: ${user.registeredAt}`);
});

// View Products
bot.command('products', async (ctx) => {
  const products = await Product.find();

  if (products.length === 0) {
    return ctx.reply('No products available.');
  }

  products.forEach((product) => {
    const priceAfterDiscount = product.price - (product.price * product.discount) / 100;
    ctx.replyWithPhoto(product.imageUrl, {
      caption: `${product.name}\n${product.description}\nPrice: $${priceAfterDiscount} (Discount: ${product.discount}%)`,
      ...Markup.inlineKeyboard([Markup.button.callback('🛒 Buy Now', `buy_${product._id}`)]),
    });
  });
});

// View Categories
bot.command('categories', (ctx) => {
  const categories = ['Electronics', 'Books', 'Clothing', 'Accessories']; // Example categories
  ctx.reply('Choose a category:', Markup.inlineKeyboard(
    categories.map((cat) => Markup.button.callback(cat, `category_${cat}`))
  ));
});

// Admin Stats
bot.command('admin', async (ctx) => {
  if (ctx.from.id.toString() !== process.env.ADMIN_ID) {
    return ctx.reply('Unauthorized access.');
  }

  const totalUsers = await User.countDocuments();
  const totalOrders = await Order.countDocuments();
  const totalRevenue = (await Order.find({ status: 'paid' }))
    .reduce((sum, order) => sum + order.amount, 0);

  ctx.reply(`Admin Stats:\n\nTotal Users: ${totalUsers}\nTotal Orders: ${totalOrders}\nTotal Revenue: $${totalRevenue}`);
});

// Add Product
bot.command('addproduct', async (ctx) => {
  if (ctx.from.id.toString() !== process.env.ADMIN_ID) {
    return ctx.reply('Unauthorized access.');
  }

  ctx.reply('Send product details in the format: Name|Description|Price|ImageUrl|Category');
  bot.on('text', async (ctx) => {
    const [name, description, price, imageUrl, category] = ctx.message.text.split('|');

    if (!name || !price || !description || !imageUrl || !category) {
      return ctx.reply('Invalid format. Use: Name|Description|Price|ImageUrl|Category');
    }

    const product = new Product({ name, description, price: parseFloat(price), imageUrl, category });
    await product.save();
    ctx.reply('Product added successfully!');
  });
});

