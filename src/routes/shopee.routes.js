const express = require('express');
const router = express.Router();
const { handleShopeeWebhook } = require('../controllers/shopee.controller');

router.post('/webhook', handleShopeeWebhook);

module.exports = router;
