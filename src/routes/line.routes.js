const express = require('express');
const router = express.Router();
const { handleLineWebhook  } = require('../controllers/chat.controller');

// webhook สำหรับ Line Messaging API
router.post('/webhook/:accountId', handleLineWebhook);
 

module.exports = router;
