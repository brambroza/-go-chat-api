---
name: chat-task
description: ทำ feature ใน go-chat-api ตั้งแต่อ่าน spec สำรวจโค้ด วางแผน implement จนถึง verify และสรุป ใช้เมื่อได้รับ task feature จาก sprint
---

# Task / Feature — go-chat-api

## Phase 1 — เข้าใจงาน

ก่อนแตะโค้ด ต้องตอบให้ได้:
- feature นี้ **ใครใช้** — CRM web (`go-crm-24v4`) / RN app (`NIS-OnsiteService`) / LINE user / ระบบภายใน
- ช่องทางคือ REST หรือ socket หรือทั้งคู่
- ต้องมีข้อมูลจาก DB ไหม และ **SP ที่ต้องใช้มีอยู่แล้วหรือยัง**
- acceptance criteria คืออะไร (ยิงอะไรแล้วต้องได้อะไร)

ถ้าข้อไหนไม่ชัด **ถามก่อน** ห้ามเดา

## Phase 2 — สำรวจ

1. อ่าน `CLAUDE.md` หัวข้อ Module map + Route map + Socket contract
2. Grep หา endpoint/ฟังก์ชันที่ใกล้เคียงที่สุดที่ทำงานคล้ายกันอยู่แล้ว — จะ copy pattern จากตรงนั้น
3. ถ้าต้องใช้ SP: `grep -rn "dbo.<ชื่อ>" src` ดูว่ามีใครเรียกอยู่แล้วและส่ง parameter อย่างไร
4. ถ้าใช้ SP ที่ยังไม่มี → **หยุด** แจ้งผู้ใช้ว่าเป็นงานฝั่ง `coreapi-new` และเสนอ signature ที่ต้องการ

## Phase 3 — วางแผนแล้วแจ้งก่อนลงมือ

บอกผู้ใช้สั้น ๆ:
- ไฟล์ที่จะแตะ (ถ้าเกิน 2 ไฟล์ ต้องแจ้งก่อนเสมอ)
- route หรือ event ที่จะเพิ่ม (ชื่อเต็ม + payload)
- อะไรที่ **ไม่** ทำใน task นี้

ถ้าต้องเพิ่ม env ใหม่ ต้องบอกตั้งแต่ตอนนี้ พร้อมค่า default ที่ปลอดภัยเมื่อไม่ได้ตั้ง

## Phase 4 — Implement

ลำดับที่ทำให้ diff เล็กและตรวจง่าย:

1. service (ถ้ามี logic เรียก external / DB) → `src/services/`
2. controller → `src/controllers/` (`exports.fn = async (req, res) => {}`)
3. route → `src/routes/` + mount ใน `src/routes/index.js` ถ้าเป็น prefix ใหม่
4. socket handler (ถ้ามี) → namespace ที่ถูกต้อง (`/nis` สำหรับ RN, default สำหรับ CRM)
5. swagger jsdoc comment ถ้า endpoint นั้นมีคนนอกทีมเรียก

กฎระหว่างเขียน:
- CommonJS · JSDoc ทุกฟังก์ชันใหม่ · validate input ครบก่อนใช้งาน
- query parameterized เท่านั้น · SQL type ตรงกับ column
- ห้ามแตะ route / event / response shape เดิม
- ห้าม refactor โค้ดรอบข้างที่ไม่เกี่ยวกับ task
- feature ที่เพิ่ม state ใน memory ต้องคิดเรื่องหลาย replica ก่อน (ดู `CLAUDE.md` หัวข้อ 5)

## Phase 5 — Verify

รัน `/chat-verify` หรืออย่างน้อย:

```bash
node --check <ไฟล์ที่แก้ทุกไฟล์>
npm run dev            # ต้อง boot ผ่าน ไม่มี error ใหม่
curl -i http://localhost:3000/api/<endpoint ใหม่>     # happy path + case ที่ต้องได้ 400/401
```

ถ้าเป็น socket: ต่อ client ทดสอบ ตรวจว่า emit เข้าห้องถูกและ payload ตรง contract

## Phase 6 — รายงาน (ภาษาไทย)

```
Feature:  ...
เพิ่ม:     src/routes/x.routes.js — POST /api/x/y
          src/controllers/x.controller.js:12 — <ฟังก์ชัน>
ใช้ SP:    dbo.xxx (มีอยู่แล้ว)
ทดสอบ:    <คำสั่ง> ผล <ผลลัพธ์>
กระทบ:    go-crm-24v4 ต้องเรียก ... / ไม่กระทบ client
ยังไม่ทำ:  ...
```

commit type `feat(<scope>): ...` — **แต่ห้าม commit จนกว่าผู้ใช้จะสั่ง**
