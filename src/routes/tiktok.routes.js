const express = require('express');
const router = express.Router();
const { handleTiktokWebhook } = require('../controllers/tiktok.controller');

// สมมติ TikTok ส่ง webhook POST มาที่นี่
router.post('/webhook', handleTiktokWebhook);

module.exports = router;
