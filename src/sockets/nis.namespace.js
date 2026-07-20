// ══════════════════════════════════════════════════════════════════
// /nis namespace (M-RT1) — realtime ของ NIS Onsite (RN app) แยกขาดจาก
// default namespace เดิมที่ CRM web ใช้ (joinRoom/ReceiveNotification/localchat)
// → ห้ามแตะ contract เดิม · ทุกอย่างของ NIS อยู่ในไฟล์นี้เท่านั้น
//
// contract v1 (ตรงกับ RN NIS-OnsiteService src/api/socket.ts):
//   handshake auth: { token (JWT coreapi), cmpid, fullName }
//   client→server: nis:chat:join/leave {ticketId} · nis:chat:send {ticketId,text,tempId} (ack)
//   server→client: nis:chat:message {id,ticketId,sender,senderName,text,at}
//                  nis:notify {type,ticketId,title,body,at} (ยิงจาก internal notify endpoint)
//   rooms: nischat_{cmpid}_{ticketId} · nisuser_{cmpid}_{userlogin} (auto-join ตอน connect)
//
// identity: sender มาจาก JWT (decoded.sub) เท่านั้น — ห้ามรับจาก client payload
// ⚠️ cmpid/fullName มาจาก handshake (token coreapi ยังไม่มี claim นี้) — ใช้ scope ห้อง/แสดงผล
//    TODO(M-RT1.1): เพิ่ม claim cmpid ใน coreapi token แล้วเปลี่ยนมาอ่านจาก token
// ══════════════════════════════════════════════════════════════════
const { verifyNisToken } = require("../utils/nisjwt.util");
const { saveMessage } = require("../services/nischat.service");

const MAX_TEXT_LEN = 2000;
const MAX_ID_LEN = 50;

function chatRoom(cmpid, ticketId) {
  return `nischat_${cmpid}_${ticketId}`;
}

function userRoom(cmpid, userlogin) {
  return `nisuser_${cmpid}_${userlogin}`;
}

function validTicketId(v) {
  return typeof v === "string" && v.length > 0 && v.length <= MAX_ID_LEN;
}

/** ผูก namespace /nis เข้า io — เรียกครั้งเดียวจาก app.js (หลัง setIO) */
function registerNisNamespace(io) {
  const nis = io.of("/nis");

  // ── auth ที่ handshake — ไม่มี/ปลอม token = ปฏิเสธตั้งแต่ connect ──
  nis.use((socket, next) => {
    const { token, cmpid, fullName } = socket.handshake.auth || {};
    const decoded = verifyNisToken(token);
    if (!decoded || !decoded.sub) return next(new Error("unauthorized"));
    if (typeof cmpid !== "string" || !cmpid || cmpid.length > 20) {
      return next(new Error("missing cmpid"));
    }
    socket.data.username = decoded.sub;
    socket.data.role = decoded.role || "";
    socket.data.cmpid = cmpid;
    socket.data.fullName =
      typeof fullName === "string" && fullName ? fullName.slice(0, 200) : decoded.sub;
    next();
  });

  nis.on("connection", (socket) => {
    const { username, cmpid, fullName } = socket.data;
    // auto-join ห้องส่วนตัว (รับ nis:notify) — client ไม่ต้อง emit เอง
    socket.join(userRoom(cmpid, username));
    console.log(`[nis] connected ${username}@${cmpid} (${socket.id})`);

    socket.on("nis:chat:join", (payload) => {
      const ticketId = payload?.ticketId;
      if (!validTicketId(ticketId)) return;
      socket.join(chatRoom(cmpid, ticketId));
    });

    socket.on("nis:chat:leave", (payload) => {
      const ticketId = payload?.ticketId;
      if (!validTicketId(ticketId)) return;
      socket.leave(chatRoom(cmpid, ticketId));
    });

    socket.on("nis:chat:send", async (payload, ack) => {
      const done = typeof ack === "function" ? ack : () => {};
      try {
        const ticketId = payload?.ticketId;
        const text = typeof payload?.text === "string" ? payload.text.trim() : "";
        if (!validTicketId(ticketId) || !text || text.length > MAX_TEXT_LEN) {
          return done({ ok: false, error: "invalid payload" });
        }

        // identity จาก JWT/handshake เท่านั้น (payload ไม่มีสิทธิ์กำหนดผู้ส่ง)
        const saved = await saveMessage({
          cmpid,
          ticketId,
          sender: username,
          senderName: fullName,
          text,
        });

        const msg = {
          id: saved.id,
          ticketId,
          sender: username,
          senderName: fullName,
          text,
          at: saved.at,
        };
        // broadcast ให้คนอื่นในห้อง (ผู้ส่งได้ผลผ่าน ack — ไม่ echo)
        socket.to(chatRoom(cmpid, ticketId)).emit("nis:chat:message", msg);
        done({ ok: true, id: saved.id, at: saved.at });
      } catch (err) {
        console.error("[nis] chat:send error:", err);
        done({ ok: false, error: "internal error" });
      }
    });

    socket.on("disconnect", () => {
      console.log(`[nis] disconnected ${username}@${cmpid} (${socket.id})`);
    });
  });

  return nis;
}

module.exports = { registerNisNamespace, chatRoom, userRoom };
