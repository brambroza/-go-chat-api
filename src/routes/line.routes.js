const express = require("express");
const multer = require("multer");
const path = require("path");
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
  uploadfiles,
  checkContact, 
} = require("../controllers/line.constroller");

function uuidv4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function sanitizeFileName(originalName) {
  const ext = path.extname(originalName); // เช่น .jpg
  return `${uuidv4()}${ext}`;
}

// configure multer storage
const storage = multer.diskStorage({
  /*  destination: (_, __, cb) => cb(null, uploadDir), */
  destination: (_, __, cb) => {
    console.log("📂 Saving to:", uploadDir); // log ตำแหน่งที่จะเขียน
    cb(null, uploadDir);
  },

  // filename: (_, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  filename: (_, file, cb) => {
    const newName = sanitizeFileName(file.originalname);
    console.log("📸 Uploading file:", file.originalname, "→", newName);
    cb(null, newName);
  },
});

const upload = multer({ storage });

router.post("/helpdesk", upload.array("image", 10), createHelpdeskCase);
router.post("/uploadsfiles", upload.array("image", 10), uploadfiles);
router.post("/contact", saveContact);
router.post("/contact/check", checkContact);
router.post("/problem/rate", rateProblem);
router.post("/problem/sendmsgwaiting", sendFlexMsgWaiting);
router.post("/problem/sendfinish", sendCaseClosedMessage);

// webhook สำหรับ Line Messaging API
router.post("/webhook/:accountId", handleLineWebhook);

module.exports = router;
