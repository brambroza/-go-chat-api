const express = require('express');
const router = express.Router();

// import routes
const authRoutes = require('./auth.routes');
const lineRoutes = require('./line.routes');
const fbRoutes = require('./fb.routes');
const tiktokRoutes = require('./tiktok.routes');
const shopeeRoutes = require('./shopee.routes');
const lazadaRoutes = require('./lazada.routes');
const whatsappRoutes = require('./whatsapp.routes');
const chatRoutes = require('./chat.routes'); 
const dashboardRoutes = require('./config.routes');
const serviceRoutes = require('./service.router');

// ใช้ routes สำหรับ dashboard config
router.use('/dashboard', dashboardRoutes);

// เพิ่ม prefix path ให้ router
router.use('/auth', authRoutes);
router.use('/line', lineRoutes);
router.use('/fb', fbRoutes);
router.use('/tiktok', tiktokRoutes);
router.use('/shopee', shopeeRoutes);
router.use('/lazada', lazadaRoutes);
router.use('/whatsapp', whatsappRoutes);
router.use('/chat', chatRoutes);
router.use('/service', serviceRoutes);


module.exports = router;
