const { publishToQueue } = require('../config/rabbitmq');
const shopeeService = require('../services/shopee.service');

exports.handleShopeeWebhook = async (req, res) => {
  try {
    const body = req.body;
    console.log('Shopee Webhook:', body);

    // ตรวจสอบ signature ถ้า Shopee กำหนด (ตัวอย่าง)
    // shopeeService.verifySignature(req.headers['Authorization'], body);

    // ส่งเข้า RabbitMQ
    await publishToQueue('shopeeQueue', body);

    // อาจจะมี logic ตอบกลับหรือเก็บลง DB
    // ...

    return res.status(200).json({ message: 'OK' });
  } catch (error) {
    console.error('Shopee Webhook Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
