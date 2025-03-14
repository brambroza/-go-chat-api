const { publishToQueue } = require('../config/rabbitmq');
const tiktokService = require('../services/tiktok.service');

/** 
 * ตัวอย่างการ handle TikTok webhook 
 * (โค้ดจริงจะขึ้นอยู่กับ TikTok API หรือ TikTok for Business / TikTok Shop)
 */
exports.handleTiktokWebhook = async (req, res) => {
  try {
    const body = req.body;
    console.log('TikTok Webhook:', body);
    
    // อาจจะต้องตรวจสอบ Signature ก่อน (ถ้ามี)
    // tiktokService.verifySignature(req.headers, body);

    // ส่ง event เข้า RabbitMQ
    await publishToQueue('tiktokQueue', body);

    // ถ้าต้องการตอบกลับ หรือประมวลผลต่อ:
    // tiktokService.doSomething(body);

    return res.status(200).json({ message: 'TikTok webhook received' });
  } catch (error) {
    console.error('TikTok Webhook Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
