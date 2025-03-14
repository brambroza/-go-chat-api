const express = require('express');
const router = express.Router();
const { handleLazadaWebhook } = require('../controllers/lazada.controller');

router.post('/webhook', handleLazadaWebhook);

module.exports = router;
