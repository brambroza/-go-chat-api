---
name: chat-verify
description: ตรวจงานใน go-chat-api ก่อนส่ง — syntax, boot, ยิง endpoint, ตรวจ socket, ตรวจ regression และ security ใช้ทุกครั้งก่อนสรุปงานหรือก่อนขอ merge
---

# Verify — go-chat-api

repo นี้ **ไม่มี automated test** (`npm test` ตั้งใจให้ fail) — การตรวจจึงต้องทำตามขั้นตอนนี้ทุกครั้ง

## 1. Syntax

```bash
node --check <ทุกไฟล์ที่แก้>
```

## 2. Boot

```bash
npm run dev
```

ต้องเห็นครบและไม่มี error ใหม่:
```
Connected to MSSQL
RabbitMQ connected        # ถ้าล้ม จะ log error แต่ไปต่อได้
[Redis] connected
Server is running on port 3000
```

หมายเหตุ: Redis ต่อไม่ได้ = โปรเซส `process.exit(1)` (พฤติกรรมเดิม ไม่ใช่บั๊กที่ต้องแก้)

## 3. REST

```bash
curl -i http://localhost:3000/api-docs                      # swagger ต้องยังโหลด
curl -i -X POST http://localhost:3000/api/<path> -H "Content-Type: application/json" -d '{...}'
```

ตรวจครบ 4 เคสสำหรับ endpoint ที่แตะ:
- happy path → 200 + payload ถูก
- ไม่ส่ง field บังคับ → 400 พร้อมข้อความระบุ field
- ไม่มี/ผิด token (ถ้ามี auth) → 401
- ค่ายาวเกิน limit → 400

## 4. Socket

ถ้าแตะ realtime — ต่อ client ทดสอบแล้วตรวจ:
- default namespace: `joinRoom {cmpid, userlogin}` แล้วต้องได้ `ReceiveNotification`
  (เป็น **string** ของ array) เมื่อมี event เกิดขึ้น
- `/nis`: handshake ที่ไม่มี token ต้องถูกปฏิเสธ · join ห้องแล้วส่ง `nis:chat:send` ต้องได้ ack `{ok:true}`
  และคนอื่นในห้องได้ `nis:chat:message` ส่วนผู้ส่งต้องไม่ได้ echo
- ตรวจว่า event เข้าเฉพาะห้องที่ควรเข้า ไม่ broadcast ทั้งระบบโดยไม่ตั้งใจ

## 5. Regression checklist

- [ ] route เดิมทั้งหมดใน `src/routes/index.js` ยัง mount ครบ
- [ ] socket event เดิมยังชื่อเดิม ห้องเดิม payload เดิม
- [ ] LINE webhook ยังตอบ 200 ทันทีและ dedupe ทำงาน
- [ ] cron ใน `app.js` ยังลงทะเบียนครบ 3 ตัว และไม่ throw ตอน start
- [ ] ฟังก์ชัน/SP ที่แก้ ถูกใช้ที่อื่นไหม (`grep -rn`) — ถ้าใช่ ตรวจผลกระทบทุกจุด

## 6. Security checklist

- [ ] ไม่มี secret / token / password ใน diff และไม่มีการ log ค่าเหล่านี้
- [ ] query ทั้งหมด parameterized ไม่มี string concat ค่าจากผู้ใช้
- [ ] input ใหม่ validate ครบ (มีค่า / type / ความยาว)
- [ ] auth ของ endpoint ไม่ถูกถอดโดยไม่ตั้งใจ · internal endpoint ยังเช็ค `x-internal-secret`
- [ ] identity ใน socket ยังมาจาก JWT ไม่ใช่ payload
- [ ] ชื่อไฟล์อัปโหลดยังผ่าน `sanitizeFileName`
- [ ] `git status` ไม่มี `.env` หรือไฟล์ใน `uploads/` ติดเข้าไป

## 7. สรุปให้ผู้ใช้ (ภาษาไทย)

```
ตรวจแล้ว:
- node --check: ผ่าน (<n> ไฟล์)
- boot: ผ่าน ไม่มี error ใหม่
- REST: <endpoint> happy path 200 · missing field 400 · no token 401
- Socket: <event> เข้าห้อง <room> ถูกต้อง
- Regression: <สิ่งที่ตรวจ> ไม่พบปัญหา
ยังไม่ได้ตรวจ: <สิ่งที่ทำไม่ได้ในเครื่องนี้ + เหตุผล>
```

สิ่งที่ตรวจไม่ได้ **ต้องบอกตรง ๆ** ห้ามเขียนว่าผ่านทั้งที่ไม่ได้ทดสอบ
