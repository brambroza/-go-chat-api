const express = require('express');
const router = express.Router();
const { handleWhatsappWebhook, verifyWhatsappWebhook } = require('../controllers/whatsapp.controller');

// บางครั้ง WhatsApp (Business API) ก็ต้อง verify token (GET)
router.get('/webhook', verifyWhatsappWebhook);

// รับ event (POST)
router.post('/webhook', handleWhatsappWebhook);

module.exports = router;
