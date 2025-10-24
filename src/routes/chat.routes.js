const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/auth.middleware");
const {
  sendMessage,
  getMessages,
  getLineFriend,
  getMessagesTitle,
  getLineChatConvertsatition,
  getChatConvertsationUserId, 
  setReadLineMsg,
} = require("../controllers/chat.controller");

 

// POST /chat/send
router.post("/send", authMiddleware, sendMessage);

// GET /chat/history
router.get("/history", authMiddleware, getMessages);

// get line friend
router.get("/getLineFriend", authMiddleware, getLineFriend);
router.get("/getconvertsation", authMiddleware, getLineChatConvertsatition);
router.post("/setreadlinechat", authMiddleware, setReadLineMsg);
 
// get message title
router.get(
  "/convertsationuserid",
  authMiddleware,
  getChatConvertsationUserId
);

module.exports = router;
