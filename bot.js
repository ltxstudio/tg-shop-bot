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
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error(err));

// Middleware: User Registration
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
    ctx.reply('🎉 Welcome to our shop! You are now registered.');
  }

  ctx.state.user = user;
  return next();
});

// Commands: Start
bot.start((ctx) => {
  ctx.reply(
    '🎉 Welcome to the shop! Explore our products and enjoy seamless shopping.',
    Markup.keyboard([
      ['🛍️ Products', '📦 My Orders'],
      ['❤️ Wishlist', '🔍 Search'],
      ['👤 Profile', '📞 Contact Support'],
    ]).resize()
  );
});

// Command: Products
bot.command('products', async (ctx) => {
  const products = await Product.find();

  if (products.length === 0) {
    return ctx.reply('❌ No products available.');
  }

  products.forEach((product) => {
    const discountedPrice = product.price - (product.price * product.discount) / 100;

    ctx.replyWithPhoto(product.imageUrl, {
      caption: `📦 *${product.name}*\n💬 ${product.description}\n💵 Price: $${discountedPrice} (Discount: ${product.discount}%)`,
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        Markup.button.callback('🛒 Buy Now', `buy_${product._id}`),
        Markup.button.callback('❤️ Add to Wishlist', `wishlist_add_${product._id}`),
      ]),
    });
  });
});

// Command: Wishlist
bot.command('wishlist', async (ctx) => {
  const user = await User.findById(ctx.state.user._id).populate('wishlist');

  if (user.wishlist.length === 0) {
    return ctx.reply('❤️ Your wishlist is empty.');
  }

  user.wishlist.forEach((product) => {
    ctx.replyWithPhoto(product.imageUrl, {
      caption: `📦 *${product.name}*\n💬 ${product.description}\n💵 Price: $${product.price}`,
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([Markup.button.callback('🛒 Buy Now', `buy_${product._id}`)]),
    });
  });
});

// Command: My Orders
bot.command('orders', async (ctx) => {
  const orders = await Order.find({ userId: ctx.state.user.telegramId }).populate('productId');

  if (orders.length === 0) {
    return ctx.reply('📦 You have no orders.');
  }

  orders.forEach((order) => {
    const statusEmoji = order.status === 'paid' ? '✅' : order.status === 'canceled' ? '❌' : '⏳';
    ctx.replyWithPhoto(order.productId.imageUrl, {
      caption: `📦 *Order Details*\n\n🛒 Product: ${order.productId.name}\n💵 Amount: $${order.amount}\n🗓 Date: ${order.createdAt}\n\nStatus: ${statusEmoji} ${order.status}`,
      parse_mode: 'Markdown',
    });
  });
});

// Command: Profile
bot.command('profile', (ctx) => {
  const user = ctx.state.user;

  ctx.reply(
    `👤 *Your Profile*\n\nUsername: @${user.username}\nFull Name: ${user.fullName}\nRegistered At: ${user.registeredAt.toDateString()}`,
    { parse_mode: 'Markdown' }
  );
});

// Command: Contact Support
bot.command('contact', (ctx) => {
  ctx.reply('📞 Contact Support\n\nPlease send your message, and we will get back to you soon.');
});

// Handle Support Messages
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return; // Skip commands
  const message = ctx.message.text;

  // Notify admin about the message
  bot.telegram.sendMessage(
    process.env.ADMIN_ID,
    `📩 *New Support Message*\n\n👤 From: @${ctx.from.username} (${ctx.from.id})\n\n💬 Message: ${message}`,
    { parse_mode: 'Markdown' }
  );

  ctx.reply('✅ Your message has been sent to support. We will contact you soon.');
});

// Admin Commands
bot.command('admin', (ctx) => {
  if (ctx.from.id.toString() !== process.env.ADMIN_ID) {
    return ctx.reply('❌ Unauthorized access.');
  }

  ctx.reply(
    '👨‍💻 Admin Panel',
    Markup.keyboard([
      ['➕ Add Product', '🛒 Manage Orders'],
      ['📊 Stats', '🔙 Back to Main'],
    ]).resize()
  );
});

// Payment Integration: Handle Buy Now
bot.action(/^buy_(.+)$/, async (ctx) => {
  const productId = ctx.match[1];
  const product = await Product.findById(productId);

  if (!product) {
    return ctx.reply('❌ Product not found.');
  }

  const discountedPrice = product.price - (product.price * product.discount) / 100;

  // Create payment invoice
  const invoice = await cryptoBot.createInvoice({
    asset: 'USDT',
    amount: discountedPrice,
    description: `Payment for ${product.name}`,
    hidden_message: 'Thank you for your purchase!',
    payload: JSON.stringify({ userId: ctx.state.user.telegramId, productId: product._id }),
    paid_btn_name: 'callback',
    paid_btn_url: process.env.TELEGRAM_BOT_URL,
  });

  // Save order with status pending
  const order = new Order({
    userId: ctx.state.user.telegramId,
    productId: product._id,
    amount: discountedPrice,
    status: 'pending',
    paymentId: invoice.invoice_id,
  });

  await order.save();

  ctx.replyWithMarkdown(
    `💳 *Pay Now*\n\nProduct: *${product.name}*\nAmount: *$${discountedPrice}*\n\n[Pay Here](${invoice.pay_url})`
  );
});

// Start the bot
bot.launch().then(() => console.log('🚀 Bot is running'));
