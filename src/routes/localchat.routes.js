const express = require('express');
const router = express.Router();
const { ticketTaskReplyHub  } = require('../controllers/localchat.controller');

// webhook สำหรับ Line Messaging API
router.post('/ticketReply', ticketTaskReplyHub);
 

module.exports = router;
