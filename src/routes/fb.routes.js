const express = require('express');
const router = express.Router();
const { handleFbWebhook, verifyFbWebhook } = require('../controllers/fb.controller');

// Facebook Messenger มักต้องการให้ยืนยัน webhook (GET)
router.get('/webhook', verifyFbWebhook);

// รับข้อความจาก webhook (POST)
router.post('/webhook', handleFbWebhook);
router.post('/webhook/:accountId', handleFbWebhook);

module.exports = router;
