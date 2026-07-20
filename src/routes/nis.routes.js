// NIS realtime routes (M-RT1) — mount ใต้ /api/nis (ดู routes/index.js)
const express = require("express");
const router = express.Router();

const nisauth = require("../middlewares/nisauth.middleware");
const { getChatHistory, postNotify } = require("../controllers/nisrealtime.controller");

// history แชทต่อ ticket — ต้องมี token NIS (coreapi)
router.get("/chat/:ticketId/messages", nisauth, getChatHistory);

// internal notify bridge — auth ด้วย x-internal-secret ภายใน controller (ไม่ใช่ JWT)
router.post("/realtime/notify", postNotify);

module.exports = router;
