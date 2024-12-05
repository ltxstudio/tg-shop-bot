const express = require('express');
const bodyParser = require('body-parser');
const Order = require('./models/order');

const app = express();
app.use(bodyParser.json());

// Handle payment webhook
app.post('/payment', async (req, res) => {
  const { invoice_id, status } = req.body;

  const order = await Order.findOne({ paymentId: invoice_id });

  if (!order) {
    return res.status(404).send('Order not found');
  }

  if (status === 'paid') {
    order.status = 'paid';
    await order.save();
    bot.telegram.sendMessage(order.userId, 'Your payment was successful!');
  }

  res.sendStatus(200);
});

app.listen(3000, () => console.log('Webhook server running on port 3000'));
