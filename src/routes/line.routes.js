const express = require("express");
const multer = require("multer");
const router = express.Router();
const { handleLineWebhook } = require("../controllers/chat.controller");
const {
  uploadDir,
  createHelpdeskCase,
  saveContact,
  rateProblem,
  sendFlexMsgWaiting, 
  sendCaseClosedMessage,
} = require("../controllers/line.constroller");

// configure multer storage
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage });

router.post("/helpdesk", upload.single("image"), createHelpdeskCase);
router.post("/contact", saveContact);
router.post("/problem/rate" ,rateProblem);
router.post("/problem/sendmsgwaiting" ,sendFlexMsgWaiting);
router.post("/problem/sendfinish" ,sendCaseClosedMessage);

// webhook สำหรับ Line Messaging API
router.post("/webhook/:accountId", handleLineWebhook);

module.exports = router;
