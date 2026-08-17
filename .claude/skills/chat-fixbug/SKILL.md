---
name: chat-fixbug
description: แก้บั๊กใน go-chat-api ตั้งแต่ triage, reproduce, หา root cause, fix แบบแคบที่สุด จนถึงตรวจ regression ใช้เมื่อได้ bug report เรื่องข้อความไม่เข้า notification ไม่เด้ง หรือ error จาก production
---

# Fix Bug — go-chat-api

## Phase 1 — Triage

เก็บให้ครบก่อนแก้ ถ้าขาดให้ถาม:
- อาการที่เห็น กับ ที่ควรเป็น
- ช่องทางไหน: LINE inbound / LINE outbound / helpdesk LIFF / notification CRM / chat RN (`/nis`) / marketplace อื่น
- ใครเจอ: ลูกค้าปลายทาง, พนักงานใน CRM, ช่างใน RN app
- เวลาที่เกิด (สำคัญมากสำหรับหา log) + เกิดทุกครั้งหรือบางครั้ง
- Environment (local / production) และเพิ่งเกิดหลัง deploy ไหนไหม
- Error message / stack trace เต็ม, HTTP status, payload ที่ยิง

จัดระดับตาม SLA ของ GoAlong:

| Priority | นิยามในระบบนี้ | Response / Resolve |
| --- | --- | --- |
| P1 | ข้อความลูกค้าหาย, webhook ตาย, socket ล่มทั้งระบบ, secret รั่ว | 1 ชม. / 24 ชม. |
| P2 | notification ไม่เด้งบางเคส, Flex เพี้ยน, ไฟล์แนบไม่ขึ้น | 4 ชม. / 72 ชม. |
| P3 | ข้อความแสดงผลไม่สวย, log รก | 24 ชม. / sprint ถัดไป |

P1 แจ้ง Technical Lead + Management ทันที

## Phase 2 — Reproduce

- หา endpoint / event ที่เกี่ยวด้วย Grep จาก URL, ชื่อ event, หรือข้อความ error
- ยิงซ้ำด้วย `curl` payload เดียวกัน (webhook LINE จำลองได้ด้วย body ตัวอย่างจาก log)
- **ห้ามยิง LINE API จริงไปหาลูกค้าเพื่อทดสอบ** — ขออนุญาตและใช้ OA/บัญชีทดสอบ
- ถ้าซ้ำไม่ได้ ระบุว่าต่างกันตรงไหน (ข้อมูล, สิทธิ์, cmpId, ช่วงเวลา, ไฟล์แนบ) แล้วขอข้อมูลเพิ่ม
- **ห้ามแก้โค้ดก่อนอธิบายสาเหตุได้** ถ้ายังไม่รู้ให้บอกตรง ๆ ว่ายังไม่รู้

## Phase 3 — หา root cause

จุดที่พังบ่อยใน repo นี้:

| อาการ | สาเหตุที่มักเป็น |
| --- | --- |
| ข้อความ LINE เข้าซ้ำ 2–3 รอบ | ตอบ 200 ช้า LINE retry หรือ dedupe (`recentLineMsgIds`) ใช้ไม่ได้ข้าม replica |
| ข้อความ LINE ไม่เข้าเลย | `accountId` ใน URL webhook ไม่ตรงกับ `Name` ใน `dbo.CompanySocialChannel` หรือ token หมดอายุ |
| งาน background หลังตอบ 200 เงียบหาย | throw ใน `process.nextTick` ไม่มี catch |
| Notification ไม่เด้งใน CRM | ชื่อห้องไม่ตรง (`notification_{cmpid}_{userlogin}`), client ยังไม่ `joinRoom`, หรือส่งไม่ได้เป็น `JSON.stringify([...])` |
| RN ไม่ได้ข้อความ / เชื่อมไม่ติด | handshake auth ไม่ผ่าน (token คนละ secret — ต้องเป็น `JWT_NIS_SECRET`), ไม่ส่ง `cmpid`, หรือ join คนละ `ticketId` |
| ผู้ส่งเห็นข้อความซ้ำใน RN | ใช้ `nis.to(room)` แทน `socket.to(room)` (ต้องไม่ echo กลับผู้ส่ง) |
| history แชท NIS หายหลัง restart | DB ล้ม/ตารางไม่มี → fallback in-memory ของ `nischat.service.js` (ดู log `[nischat] DB ไม่พร้อม`) |
| เวลาคลาด 7 ชั่วโมง | ไม่ได้ใช้ `nowIsoBangkok()` / ลืมบวก offset ในโค้ดเก่า |
| Flex message ไม่ขึ้น / LINE ตอบ 400 | payload ผิด spec, ค่า `null` หลุดเข้า field text, URL รูปไม่ใช่ https |
| อัปโหลดไฟล์แล้ว 500 | `/usr/src/app/uploads` ไม่มีบนเครื่องนั้น หรือ permission ไม่พอ |
| thumbnail วิดีโอไม่ขึ้น | `thumb.service.js` มี `createThumbForLocalMp4` ซ้ำ 2 ตัว (บรรทัด 298 และ 384) ตัวหลังทับ — ต้องแก้ตัวที่ถูกใช้จริง |
| job รันซ้ำ / รันทับกัน | cron ใน `app.js` รันในทุก replica และ flag กันซ้ำเป็น memory ต่อ instance |
| ต่อ DB ไม่ได้ตอน start | `sql.connected` เช็คไม่ตรง หรือ env ผิด · Redis ล้ม = `process.exit(1)` โดยตั้งใจ |
| 401 ทั้งที่ token ถูก | ใช้ผิด middleware — `authMiddleware` (JWT ของ chat) vs `nisauth` (JWT coreapi) |

**ตรวจเสมอว่าบั๊กเดียวกันมีที่อื่นอีกไหม** — โค้ดใน `line.constroller.js` และ `chat.controller.js` ซ้ำกันเยอะ
ให้ Grep pattern เดียวกันทั้ง repo แล้วรายงานทุกจุดที่เจอ

## Phase 4 — Fix

- แก้ที่ **root cause** ไม่ใช่กลบอาการ ถ้าจำเป็นต้อง workaround ให้บอกชัดว่าเป็น workaround และหนี้ที่เหลือคืออะไร
- แก้ให้แคบที่สุด ห้าม refactor พ่วง
- เจอหลายจุด: แก้จุดที่รายงานก่อน แล้ว list จุดที่เหลือให้ผู้ใช้ตัดสินใจว่ารวมใน task นี้หรือแยก
- ถ้าสาเหตุอยู่ที่ SP หรือ schema → หยุด แจ้งว่าเป็นงานฝั่ง `coreapi-new` พร้อมระบุ SP และสิ่งที่ต้องแก้
- ถ้าสาเหตุอยู่ฝั่ง client → แจ้งเจ้าของ (`go-crm-24v4` / `NIS-OnsiteService`) อย่าแก้ฝั่ง server ให้กลบ

## Phase 5 — Verify + regression

```bash
node --check <ไฟล์ที่แก้>
npm run dev        # boot ผ่าน ไม่มี error ใหม่
```

- ยิง case ที่เคยพัง → ต้องหาย
- ยิง happy path ของ endpoint/event เดียวกัน → ต้องยังทำงาน
- ตรวจฟังก์ชันอื่นที่ใช้ helper หรือ SP เดียวกัน (`grep -rn`) ว่าไม่พัง
- ถ้าแตะ socket → ตรวจว่า client ทั้ง CRM และ RN ยังได้ event เดิมครบ

## Phase 6 — รายงาน (ภาษาไทย)

```
อาการ:      ...
สาเหตุ:     src/controllers/x.js:123 — ...
แก้:        src/controllers/x.js:123 — ...
ทดสอบ:      ... ผล ...
Regression: ตรวจ ... แล้ว ไม่พบปัญหา
เหลือ:      pattern เดียวกันยังมีที่ src/controllers/y.js:88 — ยังไม่แก้ รอตัดสินใจ
```

commit type `fix(<scope>): ...` — **ห้าม commit จนกว่าผู้ใช้จะสั่ง**
