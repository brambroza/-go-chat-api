// ══════════════════════════════════════════════════════════════════
// NIS realtime controller (M-RT1)
//   GET  /api/nis/chat/:ticketId/messages — history แชท (nisauth · RN เรียกตอนเปิดห้อง)
//   POST /api/nis/realtime/notify         — internal bridge จาก coreapi → emit nis:notify
//     ป้องกันด้วย header x-internal-secret = NIS_INTERNAL_SECRET (env · ไม่ตั้ง = ปิดใช้งาน)
// ══════════════════════════════════════════════════════════════════
const { getIO } = require("../utils/socket");
const { getMessages, nowIsoBangkok } = require("../services/nischat.service");
const { userRoom } = require("../sockets/nis.namespace");

const NOTIFY_TYPES = new Set(["assign", "reject_close", "overdue"]);

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
    return res.status(400).json({ message: "cmpid, users, type(assign|reject_close|overdue) required" });
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

module.exports = { getChatHistory, postNotify };
