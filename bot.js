const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const Product = require('./models/product');
const Order = require('./models/order');
const User = require('./models/user');
const CryptoBot = require('crypto-bot-api');
require('dotenv').config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const cryptoBot = new CryptoBot(process.env.CRYPTO_PAY_API_KEY);

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log(err));

// Middleware: Register user if not exists
bot.use(async (ctx, next) => {
  const telegramId = ctx.from.id.toString();
  let user = await User.findOne({ telegramId });

  if (!user) {
    user = new User({
      telegramId,
      username: ctx.from.username,
      fullName: `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim(),
    });
    await user.save();
    ctx.reply('Welcome to the shop! You are now registered.');
  }

  ctx.state.user = user;
  return next();
});

// View profile
bot.command('profile', async (ctx) => {
  const user = ctx.state.user;
  ctx.reply(`Your Profile:\n\nName: ${user.fullName}\nUsername: ${user.username}\nRegistered At: ${user.registeredAt}`);
});

// List categories
bot.command('categories', (ctx) => {
  const categories = ['Electronics', 'Books', 'Clothing', 'Accessories']; // Example categories
  ctx.reply('Choose a category:', Markup.inlineKeyboard(
    categories.map((cat) => Markup.button.callback(cat, `category_${cat}`))
  ));
});

// Display products by category
bot.action(/^category_(.+)$/, async (ctx) => {
  const category = ctx.match[1];
  const products = await Product.find({ category });

  if (products.length === 0) {
    return ctx.reply('No products found in this category.');
  }

  products.forEach((product) => {
    ctx.replyWithPhoto(product.imageUrl, {
      caption: `${product.name}\n${product.description}\nPrice: $${product.price}\nDiscount: ${product.discount}%`,
      ...Markup.inlineKeyboard([Markup.button.callback('Buy Now', `buy_${product._id}`)]),
    });
  });
});

// Admin command to view stats
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

// Notify admin on new purchase
bot.on('message', async (ctx) => {
  const text = ctx.message.text;

  if (text.includes('Purchase Complete')) {
    bot.telegram.sendMessage(process.env.ADMIN_ID, 'New purchase completed!');
  }
});

