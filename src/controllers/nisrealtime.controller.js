// ══════════════════════════════════════════════════════════════════
// NIS realtime controller (M-RT1, + M-RT2 PDF attachment)
//   GET  /api/nis/chat/:ticketId/messages — history แชท (nisauth · RN เรียกตอนเปิดห้อง)
//   POST /api/nis/chat/:ticketId/upload   — อัปโหลดไฟล์แนบ PDF (nisauth) แล้วเอา url ไปส่งต่อ
//                                            ผ่าน nis:chat:send (ดู nis.namespace.js contract v2)
//   POST /api/nis/realtime/notify         — internal bridge จาก coreapi → emit nis:notify
//     ป้องกันด้วย header x-internal-secret = NIS_INTERNAL_SECRET (env · ไม่ตั้ง = ปิดใช้งาน)
// ══════════════════════════════════════════════════════════════════
const fsp = require("fs/promises");
const path = require("path");
const { getIO } = require("../utils/socket");
const { getMessages, nowIsoBangkok } = require("../services/nischat.service");
const { userRoom } = require("../sockets/nis.namespace");

const NOTIFY_TYPES = new Set(["assign", "reject_close", "overdue", "accept"]);

// ── ไฟล์แนบแชท NIS (PDF เท่านั้น) ──
// path ตรงกับ docker volume เดียวกับที่ line.constroller.js ใช้ (/usr/src/app/uploads)
const UPLOAD_VOLUME_BASE = "/usr/src/app/uploads";
// โฮสต์สาธารณะที่เสิร์ฟไฟล์จริง เป็น infra-level (นอก repo นี้) — ตาม pattern เดิมที่ hardcode
// ไว้ในหลายที่ (เช่น line.service.js:71); ถ้าต้องการ override ตั้ง env NIS_CHAT_PUBLIC_BASE_URL
// (env ใหม่ — ยังไม่ได้ตั้งบน server จริง ต้องแจ้งผู้ดูแล ถ้าไม่ตั้งจะ fallback ไปโฮสต์เดิม)
const PUBLIC_BASE_URL =
  process.env.NIS_CHAT_PUBLIC_BASE_URL || "https://api.nisolution.co.th";

/** GET /api/nis/chat/:ticketId/messages?cmpid=&limit= */
async function getChatHistory(req, res) {
  try {
    const ticketId = req.params.ticketId;
    // TODO(M-RT1.1): อ่าน cmpid จาก JWT claim เมื่อ coreapi เพิ่มให้ — ตอนนี้รับจาก query
    const cmpid = String(req.query.cmpid || "").trim();
    if (!ticketId || !cmpid) {
      return res.status(400).json({ message: "ticketId and cmpid are required" });
    }
    const rows = await getMessages(cmpid, ticketId, req.query.limit);
    return res.json(rows);
  } catch (err) {
    console.error("[nis] getChatHistory error:", err);
    return res.status(500).json({ message: "internal error" });
  }
}

/**
 * POST /api/nis/chat/:ticketId/upload — อัปโหลดไฟล์แนบ PDF สำหรับแชท NIS (nisauth)
 * multipart/form-data: field "file" (PDF เท่านั้น, กรองที่ multer fileFilter ใน nis.routes.js แล้ว),
 * field "cmpid" (text field — ต้องส่งมาด้วยเพราะ token coreapi ยังไม่มี claim cmpid)
 * บันทึกไฟล์ที่ uploads/{cmpid}/nischat/{ticketId}/{uuid}.pdf แล้วคืน url ให้ client เอาไปส่งต่อ
 * ผ่าน nis:chat:send (attachmentUrl) — endpoint นี้ไม่บันทึกข้อความแชทเอง
 * @returns {{ok:true,url:string,fileName:string}}
 */
async function uploadChatAttachment(req, res) {
  try {
    const ticketId = req.params.ticketId;
    const cmpid = String(req.body?.cmpid || "").trim();

    if (!ticketId || !cmpid) {
      if (req.file) await fsp.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ message: "ticketId and cmpid are required" });
    }
    if (req.fileValidationError) {
      // ไฟล์ถูก multer fileFilter ปฏิเสธไปแล้ว (ไม่ใช่ PDF) — ไม่มี req.file ให้ลบ
      return res.status(400).json({ message: req.fileValidationError });
    }
    if (!req.file) {
      return res.status(400).json({ message: "file is required (field name: file, PDF only)" });
    }

    const destDir = path.join(UPLOAD_VOLUME_BASE, cmpid, "nischat", ticketId);
    const destPath = path.join(destDir, req.file.filename);

    try {
      await fsp.mkdir(destDir, { recursive: true });
      await fsp.rename(req.file.path, destPath);
    } catch (moveErr) {
      await fsp.unlink(req.file.path).catch(() => {});
      throw moveErr;
    }

    const url = `${PUBLIC_BASE_URL}/${cmpid}/nischat/${ticketId}/${req.file.filename}`;
    const fileName = req.file.originalname || req.file.filename;

    return res.status(200).json({ ok: true, url, fileName });
  } catch (err) {
    console.error("[nis] uploadChatAttachment error:", err);
    return res.status(500).json({ message: "internal error" });
  }
}

/**
 * POST /api/nis/realtime/notify  (internal เท่านั้น — coreapi/cron เรียก)
 * body: { cmpid, users: string|string[], type, ticketId, title, body }
 */
function postNotify(req, res) {
  const secret = process.env.NIS_INTERNAL_SECRET;
  if (!secret) {
    return res.status(503).json({ message: "notify disabled (NIS_INTERNAL_SECRET not set)" });
  }
  if (req.headers["x-internal-secret"] !== secret) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const { cmpid, users, type, ticketId, title, body } = req.body || {};
  const userList = (Array.isArray(users) ? users : [users]).filter(
    (u) => typeof u === "string" && u
  );
  if (!cmpid || userList.length === 0 || !NOTIFY_TYPES.has(type)) {
    return res
      .status(400)
      .json({ message: "cmpid, users, type(assign|reject_close|overdue|accept) required" });
  }

  const evt = {
    type,
    ticketId: String(ticketId || ""),
    title: String(title || ""),
    body: String(body || ""),
    at: nowIsoBangkok(),
  };
  const nis = getIO().of("/nis");
  userList.forEach((u) => nis.to(userRoom(String(cmpid), u)).emit("nis:notify", evt));

  return res.json({ ok: true, delivered: userList.length });
}

module.exports = { getChatHistory, postNotify, uploadChatAttachment };
