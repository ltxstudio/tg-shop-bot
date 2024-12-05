const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const { Telegraf, Markup } = require('telegraf');
const CryptoBot = require('crypto-bot-api');
const Order = require('./models/order');
const Product = require('./models/product');
const User = require('./models/user');
require('dotenv').config();

const app = express();
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const cryptoBot = new CryptoBot(process.env.CRYPTO_PAY_API_KEY);

// Middleware
app.use(bodyParser.json());

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// Telegram Bot Middleware: User Registration
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
    '🎉 Welcome to our shop! Explore our products and enjoy seamless shopping.',
    Markup.keyboard([
      ['🛍️ Products', '📦 My Orders'],
      ['❤️ Wishlist', '📞 Contact Support'],
      ['👤 Profile', '⚙️ Settings'],
    ]).resize()
  );
});

// Command: List Products
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

// Command: View Orders
bot.command('my_orders', async (ctx) => {
  const orders = await Order.find({ userId: ctx.state.user.telegramId });

  if (orders.length === 0) {
    return ctx.reply('❌ You have no orders yet.');
  }

  orders.forEach((order) => {
    ctx.replyWithMarkdown(
      `📦 *Order Details*\n\n- Product ID: ${order.productId}\n- Amount: $${order.amount}\n- Status: ${order.status}`
    );
  });
});

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

bot.command('addproduct', (ctx) => {
  if (ctx.from.id.toString() !== process.env.ADMIN_ID) {
    return ctx.reply('❌ Unauthorized access.');
  }

  ctx.reply('📦 Enter product details in the format:\n\n`Name | Description | Price | Discount | Image URL | Category`', {
    parse_mode: 'Markdown',
  });

  bot.on('text', async (ctx) => {
    const [name, description, price, discount, imageUrl, category] = ctx.message.text.split('|').map((item) => item.trim());

    if (!name || !price || !imageUrl) {
      return ctx.reply('❌ Invalid input. Please provide all required fields.');
    }

    const newProduct = new Product({ name, description, price, discount, imageUrl, category });
    await newProduct.save();

    ctx.reply('✅ Product added successfully!');
  });
});

bot.command('manage_orders', async (ctx) => {
  if (ctx.from.id.toString() !== process.env.ADMIN_ID) {
    return ctx.reply('❌ Unauthorized access.');
  }

  const orders = await Order.find({ status: 'pending' }).populate('productId');

  if (orders.length === 0) {
    return ctx.reply('📦 No pending orders.');
  }

  orders.forEach((order) => {
    ctx.replyWithPhoto(order.productId.imageUrl, {
      caption: `🛒 *Order Details*\n\nUser ID: ${order.userId}\nProduct: ${order.productId.name}\nAmount: $${order.amount}\n\nApprove or Cancel this order?`,
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        Markup.button.callback('✅ Approve', `approve_${order._id}`),
        Markup.button.callback('❌ Cancel', `cancel_${order._id}`),
      ]),
    });
  });
});

// Approve/Cancel Orders
bot.action(/^approve_(.+)$/, async (ctx) => {
  const orderId = ctx.match[1];
  const order = await Order.findById(orderId);

  if (!order) return ctx.reply('❌ Order not found.');

  order.status = 'paid';
  await order.save();

  // Notify user
  bot.telegram.sendMessage(order.userId, '✅ Your order has been approved!');
  ctx.reply('✅ Order approved.');
});

bot.action(/^cancel_(.+)$/, async (ctx) => {
  const orderId = ctx.match[1];
  const order = await Order.findById(orderId);

  if (!order) return ctx.reply('❌ Order not found.');

  order.status = 'canceled';
  await order.save();

  // Notify user
  bot.telegram.sendMessage(order.userId, '❌ Your order has been canceled.');
  ctx.reply('❌ Order canceled.');
});

// Add to Wishlist
bot.action(/^wishlist_add_(.+)$/, async (ctx) => {
  const productId = ctx.match[1];
  const user = ctx.state.user;

  if (user.wishlist.includes(productId)) {
    return ctx.reply('This product is already in your wishlist.');
  }

  user.wishlist.push(productId);
  await user.save();
  ctx.reply('Product added to your wishlist!');
});

// View Wishlist
bot.command('wishlist', async (ctx) => {
  const user = await User.findById(ctx.state.user._id).populate('wishlist');

  if (user.wishlist.length === 0) {
    return ctx.reply('Your wishlist is empty.');
  }

  user.wishlist.forEach((product) => {
    const priceAfterDiscount = product.price - (product.price * product.discount) / 100;
    ctx.replyWithPhoto(product.imageUrl, {
      caption: `${product.name}\n${product.description}\nPrice: $${priceAfterDiscount}`,
      ...Markup.inlineKeyboard([Markup.button.callback('🛒 Buy Now', `buy_${product._id}`)]),
    });
  });
});

bot.command('search', (ctx) => {
  ctx.reply('Enter the name of the product you are looking for:');
  bot.on('text', async (ctx) => {
    const query = ctx.message.text.toLowerCase();
    const products = await Product.find({ name: { $regex: query, $options: 'i' } });

    if (products.length === 0) {
      return ctx.reply('No products found.');
    }

    products.forEach((product) => {
      const priceAfterDiscount = product.price - (product.price * product.discount) / 100;
      ctx.replyWithPhoto(product.imageUrl, {
        caption: `${product.name}\n${product.description}\nPrice: $${priceAfterDiscount}`,
        ...Markup.inlineKeyboard([Markup.button.callback('🛒 Buy Now', `buy_${product._id}`)]),
      });
    });
  });
});

// Command: Wishlist
bot.command('wishlist', (ctx) => {
  // Placeholder for future wishlist implementation
  ctx.reply('❤️ Wishlist functionality coming soon!');
});

// Command: Contact Support
bot.command('contact_support', (ctx) => {
  ctx.reply(
    '📞 *Contact Support*\n\nNeed help? Send us your message, and we’ll get back to you!',
    { parse_mode: 'Markdown' }
  );
});

// Command: Profile
bot.command('profile', (ctx) => {
  const user = ctx.state.user;

  ctx.reply(
    `👤 *Your Profile*\n\nUsername: @${user.username}\nFull Name: ${user.fullName}\nRegistered At: ${user.registeredAt.toDateString()}`,
    { parse_mode: 'Markdown' }
  );
});

// Command: Settings
bot.command('settings', (ctx) => {
  ctx.reply(
    '⚙️ *Settings*\n\nComing soon: update your preferences and notifications.',
    { parse_mode: 'Markdown' }
  );
});

// Handle Payment: Buy Now
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

  // Save order
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

// Webhook: Handle CryptoBot Payment Updates
app.post('/crypto-webhook', async (req, res) => {
  const { invoice_id, status, payload } = req.body;

  try {
    const { userId, productId } = JSON.parse(payload);
    const order = await Order.findOne({ paymentId: invoice_id });

    if (!order) {
      console.log(`❌ Order with Invoice ID ${invoice_id} not found.`);
      return res.status(404).send('Order not found.');
    }

    if (status === 'paid') {
      order.status = 'paid';
      await order.save();

      const product = await Product.findById(productId);
      bot.telegram.sendMessage(
        userId,
        `✅ *Payment Successful!*\n\nThank you for purchasing *${product.name}*. Your order is now being processed.`,
        { parse_mode: 'Markdown' }
      );
      console.log(`✅ Payment for order ${order._id} completed.`);
    } else if (status === 'expired') {
      order.status = 'expired';
      await order.save();

      bot.telegram.sendMessage(userId, `❌ Your payment for order *${order._id}* has expired.`);
      console.log(`❌ Payment for order ${order._id} expired.`);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Error processing webhook:', err);
    res.sendStatus(500);
  }
});

// Start Telegram Bot
bot.launch().then(() => console.log('🚀 Telegram bot is running'));

// Start Webhook Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Webhook server running on port ${PORT}`);
});
