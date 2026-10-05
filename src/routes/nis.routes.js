// NIS realtime routes (M-RT1, + M-RT2 PDF attachment) — mount ใต้ /api/nis (ดู routes/index.js)
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const router = express.Router();

const nisauth = require("../middlewares/nisauth.middleware");
const {
  getChatHistory,
  postNotify,
  uploadChatAttachment,
} = require("../controllers/nisrealtime.controller");

// ── multer: อัปโหลดไฟล์แนบแชท NIS (PDF เท่านั้น) ──
// เก็บชั่วคราวที่ tmp ก่อน แล้วคอนโทรลเลอร์ค่อยย้ายไป uploads/{cmpid}/nischat/{ticketId}/
// (ตาม pattern เดียวกับ line.routes.js/uploadfiles ที่ไม่ผูก destination กับ field อื่นใน body)
const uploadBase = "/usr/src/app/uploads"; // <- path ตรงกับ docker -v (เดียวกับ line.constroller.js)
const tmpUploadDir = path.join(uploadBase, "nischat_tmp");
fs.mkdirSync(tmpUploadDir, { recursive: true });

function uuidv4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** uuid + นามสกุลไฟล์เดิม — ห้ามใช้ file.originalname ตรง ๆ เป็นชื่อไฟล์บนดิสก์ */
function sanitizeFileName(originalName) {
  const ext = path.extname(originalName || "").toLowerCase();
  return `${uuidv4()}${ext}`;
}

/** รับเฉพาะ PDF — เช็คทั้ง mimetype และนามสกุล ไม่ผ่าน = ปฏิเสธไฟล์ (ไม่ throw) แล้วให้ controller ตอบ 400 */
function pdfFileFilter(req, file, cb) {
  const ext = path.extname(file.originalname || "").toLowerCase();
  const isPdf = file.mimetype === "application/pdf" && ext === ".pdf";
  if (!isPdf) {
    req.fileValidationError = "only PDF files are allowed (mimetype application/pdf, extension .pdf)";
    return cb(null, false);
  }
  return cb(null, true);
}

const attachmentUpload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, tmpUploadDir),
    filename: (_, file, cb) => cb(null, sanitizeFileName(file.originalname)),
  }),
  fileFilter: pdfFileFilter,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB กันไฟล์ใหญ่ผิดปกติ (ไม่มี precedent เดิมในนี้ ตั้งเผื่อไว้)
});

// history แชทต่อ ticket — ต้องมี token NIS (coreapi)
router.get("/chat/:ticketId/messages", nisauth, getChatHistory);

// อัปโหลดไฟล์แนบ PDF สำหรับแชท NIS — ได้ url กลับไปส่งต่อผ่าน nis:chat:send (attachmentUrl)
router.post(
  "/chat/:ticketId/upload",
  nisauth,
  attachmentUpload.single("file"),
  uploadChatAttachment
);

// internal notify bridge — auth ด้วย x-internal-secret ภายใน controller (ไม่ใช่ JWT)
router.post("/realtime/notify", postNotify);

module.exports = router;
