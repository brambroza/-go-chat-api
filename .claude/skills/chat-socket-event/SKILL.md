---
name: chat-socket-event
description: เพิ่มหรือแก้ socket event ใน go-chat-api อย่างปลอดภัยต่อ contract เดิม — namespace, ห้อง, auth, validation, การ emit ใช้เมื่อทำ realtime feature หรือ notification ไม่เด้ง
---

# Socket Event — go-chat-api

## Phase 0 — อ่าน contract ก่อน

อ่าน `CLAUDE.md` หัวข้อ 3 ให้จบก่อนเขียนโค้ด
**ห้ามเปลี่ยนชื่อ event / ชื่อห้อง / รูป payload ของของเดิม** — CRM web และ RN app พึ่งอยู่
ถ้าจำเป็นต้องเปลี่ยนจริง: หยุด เสนอแผน (event ใหม่คู่ขนาน + ช่วงเปลี่ยนผ่าน + ใครแก้ฝั่ง client) ให้ผู้ใช้ตัดสินใจ

## Phase 1 — เลือก namespace ให้ถูก

| ผู้ใช้ | namespace | ไฟล์ |
| --- | --- | --- |
| CRM web (`go-crm-24v4`) | default `/` | `src/app.js`, `src/controllers/localchat.controller.js` |
| RN app (`NIS-OnsiteService`) | `/nis` | `src/sockets/nis.namespace.js` |

logic ของ NIS **ต้องอยู่ใน `nis.namespace.js` เท่านั้น** ห้ามปนใน default namespace

## Phase 2 — ตั้งชื่อและกำหนด payload

- namespace `/nis` ใช้ prefix `nis:` เช่น `nis:chat:message`, `nis:notify` — ของใหม่ตามรูปแบบนี้
- default namespace ใช้ชื่อเดิมสไตล์ `ReceiveNotification`, `helpdesk:update` — ดูของข้างเคียง
- payload ต้องเป็น object ที่ field ชัดเจน มี `at` เป็นเวลา ISO +07:00 เมื่อเกี่ยวกับ NIS
- ⚠️ `ReceiveNotification` ของ CRM ส่งเป็น **string** (`JSON.stringify([msgNotification])`) — ของเดิมเป็นแบบนั้น
  ห้ามเปลี่ยนเป็น object

## Phase 3 — เขียน handler

Template ฝั่ง server (client → server):

```js
socket.on("nis:xxx:do", async (payload, ack) => {
  const done = typeof ack === "function" ? ack : () => {};
  try {
    const ticketId = payload?.ticketId;
    if (!validTicketId(ticketId)) return done({ ok: false, error: "invalid payload" });

    // identity จาก JWT/handshake เท่านั้น — ห้ามอ่านผู้ส่งจาก payload
    const { username, cmpid, fullName } = socket.data;

    // ... ทำงาน ...

    socket.to(chatRoom(cmpid, ticketId)).emit("nis:xxx:result", result);
    done({ ok: true });
  } catch (err) {
    console.error("[nis] xxx:do error:", err);
    done({ ok: false, error: "internal error" });
  }
});
```

กฎบังคับ:
- **identity มาจาก JWT (`socket.data`) เท่านั้น** ห้ามเชื่อ `payload.sender`
- validate ทุก field: type, ความว่าง, ความยาวสูงสุด (`MAX_TEXT_LEN`, `MAX_ID_LEN`)
- ใช้ `socket.to(room)` เพื่อไม่ echo กลับผู้ส่ง (ผู้ส่งรับผลผ่าน `ack`)
  ใช้ `namespace.to(room)` เฉพาะกรณีที่ต้องการให้ทุกคนรวมผู้ส่งได้รับ
- ทุก handler async ต้อง `try/catch` — throw ใน handler ทำให้ connection พังเงียบ ๆ
- auth ทำที่ middleware ของ namespace (`.use()`) ไม่ใช่เช็คซ้ำในแต่ละ event

## Phase 4 — emit จาก HTTP หรือ cron

```js
const { getIO } = require("../utils/socket");
getIO().of("/nis").to(userRoom(cmpid, username)).emit("nis:notify", evt);
```

- ห้าม `require("../app")` เพื่อเอา io (วนกัน) — ใช้ `getIO()` จาก `src/utils/socket.js` เสมอ
- endpoint ที่ให้ระบบอื่น (coreapi) เรียกเพื่อ emit ต้องมี auth — ปัจจุบันใช้ header `x-internal-secret`
  และตอบ 503 ถ้า env ไม่ได้ตั้ง (ห้ามเปิดโล่ง)

## Phase 5 — ตรวจเรื่อง scale

- ระบบใช้ Redis adapter → `emit` ข้าม replica ได้อยู่แล้ว
- แต่ **state ใน memory ไม่ shared**: dedupe map, fallback store, flag กัน cron ซ้ำ
  ถ้า feature ใหม่ต้องการ state ที่ต้องเห็นตรงกันทุก replica ต้องใช้ Redis — เสนอผู้ใช้ก่อนทำ

## Phase 6 — Verify

```bash
node --check src/sockets/nis.namespace.js
npm run dev     # ดู log [nis] connected ตอน client ต่อ
```

- ต่อ client จริง (RN หรือ script `socket.io-client`) ตรวจ: handshake ผ่าน/ไม่ผ่านตามคาด,
  event ถึงเฉพาะห้องที่ถูกต้อง, ผู้ส่งไม่ได้รับ echo, ack กลับครบ
- ตรวจ regression: event เดิมของ CRM (`ReceiveNotification`, `server_broadcast`, `helpdesk:*`) ยังทำงาน

## Phase 7 — รายงาน + อัปเดตเอกสาร

- ระบุ: namespace, ชื่อ event, ทิศทาง, payload เต็ม, ห้องที่ใช้, auth
- **อัปเดตตาราง contract ใน `CLAUDE.md` หัวข้อ 3** ทุกครั้งที่เพิ่ม event ใหม่
- ระบุสิ่งที่ฝั่ง client ต้องทำ เพื่อส่งต่อทีม `go-crm-24v4` / `NIS-OnsiteService`
