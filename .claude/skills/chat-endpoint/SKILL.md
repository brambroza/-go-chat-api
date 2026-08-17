---
name: chat-endpoint
description: เพิ่มหรือแก้ REST endpoint ใน go-chat-api ตาม pattern ของ repo — route, controller, validation, auth, การเรียก stored procedure และ swagger ใช้เมื่อ task คือเพิ่ม API
---

# API Endpoint — go-chat-api

## Phase 1 — ตัดสินใจก่อนเขียน

ตอบให้ครบก่อนแตะไฟล์:

| คำถาม | ทางเลือกใน repo นี้ |
| --- | --- |
| อยู่ prefix ไหน | `/api/chat`, `/api/line`, `/api/nis`, `/api/service`, `/api/dashboard`, หรือ prefix ใหม่ |
| auth แบบไหน | `authMiddleware` (JWT ของ chat) · `nisauth` (JWT coreapi) · `x-internal-secret` (internal) · ไม่มี (webhook/LIFF) |
| ใครเรียก | CRM web / RN app / LIFF ในเบราว์เซอร์ / coreapi / แพลตฟอร์มภายนอก |
| ต้องใช้ SP ตัวไหน | มีอยู่แล้ว หรือยังไม่มี (ยังไม่มี = งานฝั่ง `coreapi-new` ต้องแจ้งก่อน) |

หา endpoint ที่ทำงานใกล้เคียงที่สุดในไฟล์เดิมก่อนเสมอ แล้ว copy pattern จากตรงนั้น

## Phase 2 — เขียน controller

```js
/**
 * POST /api/<prefix>/<path> — <ทำอะไร>
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
exports.doSomething = async (req, res) => {
  try {
    const { cmpid, ticketId, text } = req.body || {};

    // 1) validate ให้ครบก่อนทำอะไรทั้งสิ้น
    if (!cmpid || typeof cmpid !== "string" || cmpid.length > 20) {
      return res.status(400).json({ message: "cmpid is required" });
    }
    if (typeof text !== "string" || !text.trim() || text.length > 2000) {
      return res.status(400).json({ message: "text is required (max 2000)" });
    }

    // 2) query แบบ parameterized เท่านั้น
    const pool = await connectDB();
    const rs = await pool
      .request()
      .input("CmpId", sql.VarChar(50), cmpid)
      .input("Text", sql.NVarChar(sql.MAX), text.trim())
      .execute("dbo.setSomething");

    return res.json({ success: true, data: rs.recordset ?? [] });
  } catch (err) {
    console.error("doSomething error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
```

กฎ:
- validate ก่อนเสมอ: มีค่าไหม → type → ความยาวสูงสุด แล้วตอบ 400 พร้อมข้อความที่ระบุ field
- ห้ามเชื่อค่า identity จาก body ถ้ามี token — ใช้จาก `req.user` (`authMiddleware`/`nisauth` set ไว้ให้)
- ข้อความไทยยาวใช้ `sql.NVarChar(sql.MAX)` เสมอ
- error ตอบ 500 พร้อมข้อความกลาง ๆ · รายละเอียดไป `console.error` เท่านั้น (ห้ามส่ง stack ให้ client)

## Phase 3 — ผูก route

```js
// src/routes/<x>.routes.js
router.post("/dosomething", authMiddleware, doSomething);
```

- prefix ใหม่ต้อง mount ใน `src/routes/index.js`
- ตั้งชื่อ path ตามสไตล์ไฟล์นั้น (repo นี้ใช้ lowercase ติดกัน เช่น `/setreadlinechat`, `/getconfigdashservice`)
- **ห้ามเปลี่ยนหรือลบ route เดิม** — ถ้าต้องเปลี่ยนพฤติกรรม ให้เพิ่ม route ใหม่แล้วเสนอแผนย้าย client

## Phase 4 — Swagger (ถ้ามีคนนอกทีมเรียก)

`swagger-jsdoc` อ่านจาก `./src/routes/*.js` และ `./src/controllers/*.js`
เขียน comment `@openapi` เหนือ route แบบเดียวกับ `src/routes/auth.routes.js`
ระบุ requestBody, response 200 และ error case ที่เป็นไปได้

## Phase 5 — Verify

```bash
node --check src/routes/<x>.routes.js src/controllers/<x>.controller.js
npm run dev
curl -i -X POST http://localhost:3000/api/<prefix>/<path> \
  -H "Content-Type: application/json" -H "Authorization: Bearer <token>" \
  -d '{"cmpid":"230015","text":"test"}'
```

ต้องทดสอบครบ 4 เคส: happy path · ไม่ส่ง field บังคับ (400) · ไม่มี token (401) · ค่าเกินความยาว (400)
เช็คด้วยว่า Swagger `/api-docs` ยังโหลดได้

## Phase 6 — รายงาน

ระบุ: method + path เต็ม, auth ที่ใช้, request/response ตัวอย่างจริงจาก curl, SP ที่เรียก,
และ client ตัวไหนต้องมาเรียก (พร้อมสิ่งที่ต้องบอกทีมนั้น)
