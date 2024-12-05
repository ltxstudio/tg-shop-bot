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

// Manage Orders
bot.command('manage_orders', async (ctx) => {
  if (ctx.from.id.toString() !== process.env.ADMIN_ID) {
    return ctx.reply('Unauthorized access.');
  }

  const orders = await Order.find({ status: 'pending' }).populate('productId');

  if (orders.length === 0) {
    return ctx.reply('No pending orders.');
  }

  orders.forEach((order) => {
    ctx.replyWithPhoto(order.productId.imageUrl, {
      caption: `Order by @${order.userId}\nProduct: ${order.productId.name}\nAmount: $${order.amount}\n\nApprove or Cancel this order?`,
      ...Markup.inlineKeyboard([
        Markup.button.callback('✅ Approve', `approve_${order._id}`),
        Markup.button.callback('❌ Cancel', `cancel_${order._id}`),
      ]),
    });
  });
});

// Handle Approve/Cancel
bot.action(/^approve_(.+)$/, async (ctx) => {
  const orderId = ctx.match[1];
  const order = await Order.findById(orderId);

  if (!order) {
    return ctx.reply('Order not found.');
  }

  order.status = 'paid';
  await order.save();
  bot.telegram.sendMessage(order.userId, 'Your order has been approved! 🎉');
  ctx.reply('Order approved.');
});

bot.action(/^cancel_(.+)$/, async (ctx) => {
  const orderId = ctx.match[1];
  const order = await Order.findById(orderId);

  if (!order) {
    return ctx.reply('Order not found.');
  }

  order.status = 'canceled';
  await order.save();
  bot.telegram.sendMessage(order.userId, 'Your order has been canceled.');
  ctx.reply('Order canceled.');
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

bot.command('orders', async (ctx) => {
  const orders = await Order.find({ userId: ctx.state.user.telegramId }).populate('productId');

  if (orders.length === 0) {
    return ctx.reply('You have no orders.');
  }

  orders.forEach((order) => {
    const statusEmoji = order.status === 'paid' ? '✅' : order.status === 'canceled' ? '❌' : '⏳';
    ctx.replyWithPhoto(order.productId.imageUrl, {
      caption: `🛒 *Order Details*\n\n📦 Product: ${order.productId.name}\n💵 Price: $${order.amount}\n🗓 Date: ${order.createdAt}\n\nStatus: ${statusEmoji} ${order.status}`,
      parse_mode: 'Markdown',
    });
  });
});

bot.command('contact', (ctx) => {
  ctx.reply(
    'Please send your message to the support team. Type your query below:'
  );
  bot.on('text', async (ctx) => {
    const adminId = process.env.ADMIN_ID;
    const userMessage = ctx.message.text;
    await bot.telegram.sendMessage(adminId, `New Support Query from @${ctx.from.username}:\n\n${userMessage}`);
    ctx.reply('Your message has been sent to the support team. They will respond soon!');
  });
});
