// ══════════════════════════════════════════════════════════════════
// NIS Chat service (M-RT1) — persist ข้อความแชทลง dbo.NisChatMessages
//   - ไม่ auto-migrate: ตารางต้องถูกสร้างโดย DBA (scripts/sql/nis_chat_messages.sql)
//   - DB ล้ม/ตารางยังไม่มี → fallback in-memory ต่อห้อง (แชท realtime ยังใช้ได้
//     แต่ history หายเมื่อ restart) + log warn — กัน production ล่มเพราะฟีเจอร์ใหม่
//   - เวลา: ISO +07:00 (Asia/Bangkok) ตาม contract v1 (memory: nis-realtime-chat-plan)
// ══════════════════════════════════════════════════════════════════
const { connectDB, sql } = require("../config/database");

const MEM_CAP_PER_ROOM = 200; // กันโตไม่จำกัดตอน fallback
const memStore = new Map(); // key `${cmpid}|${ticketId}` → [{id,ticketId,sender,senderName,text,at}]
let memSeq = 0;
let warnedDbDown = 0; // throttle warn (log ทุก ~60 วิ พอ)

/** ISO 8601 เวลาไทย +07:00 (เทียบ nowIsoBangkok ฝั่ง RN) */
function nowIsoBangkok(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const g = (t) => parts.find((p) => p.type === t)?.value ?? "00";
  const hour = g("hour") === "24" ? "00" : g("hour");
  return `${g("year")}-${g("month")}-${g("day")}T${hour}:${g("minute")}:${g("second")}+07:00`;
}

function warnDbFallback(err) {
  const now = Date.now();
  if (now - warnedDbDown > 60_000) {
    warnedDbDown = now;
    console.warn(
      "[nischat] DB ไม่พร้อม → ใช้ in-memory fallback (history ไม่ persist):",
      err?.message || err
    );
  }
}

function memKey(cmpid, ticketId) {
  return `${cmpid}|${ticketId}`;
}

function memPush(cmpid, ticketId, msg) {
  const key = memKey(cmpid, ticketId);
  const list = memStore.get(key) || [];
  list.push(msg);
  if (list.length > MEM_CAP_PER_ROOM) list.splice(0, list.length - MEM_CAP_PER_ROOM);
  memStore.set(key, list);
}

/**
 * บันทึกข้อความ → คืน {id, at} (id จาก DB identity หรือ MEM-* ตอน fallback)
 * @param {{cmpid:string,ticketId:string,sender:string,senderName:string,text:string}} input
 */
async function saveMessage(input) {
  const at = nowIsoBangkok();
  try {
    const pool = await connectDB();
    const rs = await pool
      .request()
      .input("cmpid", sql.NVarChar, input.cmpid)
      .input("ticketId", sql.NVarChar, input.ticketId)
      .input("sender", sql.NVarChar, input.sender)
      .input("senderName", sql.NVarChar, input.senderName)
      .input("text", sql.NVarChar, input.text)
      .input("at", sql.NVarChar, at).query(`
        INSERT INTO [dbo].[NisChatMessages] (CmpId, TicketId, Sender, SenderName, [Text], CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@cmpid, @ticketId, @sender, @senderName, @text, @at)
      `);
    const row = rs.recordset?.[0];
    if (!row) throw new Error("insert returned no id");
    return { id: `MSG-${row.Id}`, at };
  } catch (err) {
    warnDbFallback(err);
    memSeq += 1;
    const id = `MEM-${Date.now()}-${memSeq}`;
    memPush(input.cmpid, input.ticketId, {
      id,
      ticketId: input.ticketId,
      sender: input.sender,
      senderName: input.senderName,
      text: input.text,
      at,
    });
    return { id, at };
  }
}

/**
 * ดึง history ของห้อง (เก่า→ใหม่) จำกัด limit ล่าสุด
 * @returns {Promise<Array<{id,ticketId,sender,senderName,text,at}>>}
 */
async function getMessages(cmpid, ticketId, limit = 100) {
  const top = Math.max(1, Math.min(200, Number(limit) || 100));
  try {
    const pool = await connectDB();
    const rs = await pool
      .request()
      .input("cmpid", sql.NVarChar, cmpid)
      .input("ticketId", sql.NVarChar, ticketId)
      .input("top", sql.Int, top).query(`
        SELECT TOP (@top) Id, TicketId, Sender, SenderName, [Text], CreatedAt
        FROM [dbo].[NisChatMessages]
        WHERE CmpId = @cmpid AND TicketId = @ticketId
        ORDER BY Id DESC
      `);
    const rows = rs.recordset || [];
    return rows.reverse().map((r) => ({
      id: `MSG-${r.Id}`,
      ticketId: r.TicketId,
      sender: r.Sender,
      senderName: r.SenderName || r.Sender,
      text: r.Text,
      // DATETIMEOFFSET กลับมาเป็น Date → แปลงกลับเป็น ISO เวลาไทย
      at: r.CreatedAt instanceof Date ? nowIsoBangkok(r.CreatedAt) : String(r.CreatedAt || ""),
    }));
  } catch (err) {
    warnDbFallback(err);
    const list = memStore.get(memKey(cmpid, ticketId)) || [];
    return list.slice(-top);
  }
}

module.exports = { saveMessage, getMessages, nowIsoBangkok };
