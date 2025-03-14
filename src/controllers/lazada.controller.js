const { publishToQueue } = require('../config/rabbitmq');
const lazadaService = require('../services/lazada.service');

exports.handleLazadaWebhook = async (req, res) => {
  try {
    const body = req.body;
    console.log('Lazada Webhook:', body);

    // ตรวจสอบ signature
    // lazadaService.verifySignature(req.headers, body);

    // ส่ง message เข้า RabbitMQ
    await publishToQueue('lazadaQueue', body);

    return res.status(200).json({ message: 'OK' });
  } catch (error) {
    console.error('Lazada Webhook Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
