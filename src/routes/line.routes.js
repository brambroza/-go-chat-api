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
  sendFromproblem, 
} = require("../controllers/line.constroller");
 
// configure multer storage
const storage = multer.diskStorage({
  /*  destination: (_, __, cb) => cb(null, uploadDir), */
  destination: (_, __, cb) => {
    console.log("📂 Saving to:", uploadDir); // log ตำแหน่งที่จะเขียน
    cb(null, uploadDir);
  },

  // filename: (_, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  filename: (_, file, cb) => {
    console.log("📸 Uploading file:", file.originalname);
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
const upload = multer({ storage });

router.post("/helpdesk", upload.array("image", 10), createHelpdeskCase);
router.post("/contact", saveContact);
router.post("/problem/rate", rateProblem);
router.post("/problem/sendmsgwaiting", sendFlexMsgWaiting);
router.post("/problem/sendfinish", sendCaseClosedMessage);

// webhook สำหรับ Line Messaging API
router.post("/webhook/:accountId", handleLineWebhook);
router.get("/sendfrompromblem", sendFromproblem);

module.exports = router;
