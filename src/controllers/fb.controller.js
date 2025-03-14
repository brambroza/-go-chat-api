const { publishToQueue } = require('../config/rabbitmq');
const fbService = require('../services/fb.service');

/**
 * ใช้สำหรับ Verify Webhook (GET /fb/webhook) 
 * FB จะส่ง query string เช่น ?hub.mode=subscribe&hub.verify_token=XXX&hub.challenge=1234
 */
exports.verifyFbWebhook = (req, res) => {
  let VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN || 'my_verify_token_goalong2025';

  // กรอกข้อมูลจาก query params
  let mode = req.query['hub.mode'];
  let token = req.query['hub.verify_token'];
  let challenge = req.query['hub.challenge'];

  // ตรวจสอบ mode และ token
  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('WEBHOOK_VERIFIED');
      // ส่งค่า challenge กลับไป เพื่อยืนยันการเป็นเจ้าของ webhook
      res.status(200).send(challenge);
    } else {
      // ถ้า token ไม่ตรง ให้ตอบ 403
      res.sendStatus(403);
    }
  }
};

/**
 * Handle Facebook webhook event (POST /fb/webhook)
 */
exports.handleFbWebhook = async (req, res) => {
  try {
    const body = req.body;
    // ถ้ามี object=page แสดงว่าเป็น event จากเพจ
    if (body.object === 'page') {
      body.entry.forEach(async (entry) => {
        // messaging array
        const webhookEvent = entry.messaging[0];
        console.log('Webhook event: ', webhookEvent);

        // ส่ง message เข้า RabbitMQ
        await publishToQueue('fbQueue', webhookEvent);

        // ตัวอย่าง: ถ้าเป็นข้อความ (message) จะตอบกลับ
        if (webhookEvent.message) {
          const senderId = webhookEvent.sender.id;
          const text = 'Hello from Facebook controller!';
          // เรียก service ส่งข้อความกลับไป
          fbService.sendTextMessage(senderId, text);
        }
      });
      return res.sendStatus(200);
    } else {
      return res.sendStatus(404);
    }
  } catch (error) {
    console.error('FB Webhook Error:', error);
    return res.sendStatus(500);
  }
};
