const { publishToQueue } = require('../config/rabbitmq');
const whatsappService = require('../services/whatsapp.service');

/**
 * WhatsApp Business API (Cloud API) จะยิง GET เพื่อ verify token คล้าย Facebook
 */
exports.verifyWhatsappWebhook = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('WEBHOOK_VERIFIED');
    return res.status(200).send(challenge);
  } else {
    return res.sendStatus(403);
  }
};

exports.handleWhatsappWebhook = async (req, res) => {
  try {
    const body = req.body;

    if (body.object) {
      // ตรวจสอบว่ามี entry
      if (body.entry && body.entry[0].changes && body.entry[0].changes[0]) {
        const change = body.entry[0].changes[0];
        // นี่คือตัวอย่าง structure ของ WhatsApp Cloud API
        const messageData = change.value.messages?.[0] || null;

        if (messageData) {
          console.log('Received WhatsApp message:', messageData);

          // ส่งต่อเข้าสู่ RabbitMQ
          await publishToQueue('whatsappQueue', messageData);

          // ตัวอย่าง: ตอบข้อความกลับ
          const from = messageData.from; 
          const text = 'Hello from WhatsApp controller!';
          whatsappService.sendTextMessage(from, text);
        }
      }
      return res.sendStatus(200);
    } else {
      return res.sendStatus(404);
    }
  } catch (error) {
    console.error('WhatsApp Webhook Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
