---
name: chat-sprint-plan
description: วางแผน sprint ของ go-chat-api — แตกงานเป็น task ประเมินชั่วโมง จัดลำดับ และระบุความเสี่ยง ใช้เมื่อเริ่ม sprint ใหม่หรือได้ requirement ก้อนใหญ่มา
---

# Sprint Plan — go-chat-api

## Phase 1 — เก็บ input

ถ้าขาดข้อไหนให้ถามก่อน ห้ามสมมติเอง:
- เป้าหมายของ sprint นี้คืออะไร (feature / แก้หนี้ / เสถียรภาพ)
- ระยะเวลา sprint และวันที่เริ่ม-จบ
- คนที่มี และระดับ (Junior / Mid / Senior) กี่ชั่วโมงต่อคน
- งานค้างจาก sprint ก่อน
- deadline หรือ commitment กับลูกค้าที่ผูกอยู่

## Phase 2 — แตกงาน

แตกทีละ requirement ให้เป็น task ไม่เกิน 8 ชั่วโมงต่อ task ระบุชั้นที่แตะให้ชัด:

| ชั้น | ตัวอย่างงาน | agent ที่ทำ |
| --- | --- | --- |
| REST endpoint | เพิ่ม/แก้ route, controller, validation | `chat-backend` |
| LINE / social | webhook, Flex, LIFF, media | `chat-line` |
| Realtime | socket event, ห้อง, namespace, cron | `chat-realtime` |
| DB | ต้องมี SP/column ใหม่ | **ไม่ใช่ repo นี้** — task ฝั่ง `coreapi-new` |
| Client | CRM หรือ RN ต้องแก้ตาม | task ฝั่ง `go-crm-24v4` / `NIS-OnsiteService` |

ทุก task ต้องเขียนให้ครบ: ชื่อ, ไฟล์ที่คาดว่าจะแตะ, acceptance criteria, ชั่วโมง, dependency

## Phase 3 — ประเมินชั่วโมง

ฐานประเมิน (ปรับตามความจริงของงาน):

| ประเภทงาน | ชั่วโมงตั้งต้น |
| --- | --- |
| REST endpoint ใหม่ (เรียก SP ที่มีอยู่แล้ว) | 3–5 |
| REST endpoint ใหม่ + ต้องรอ SP ใหม่จาก coreapi | 5–8 + เวลารอ |
| Socket event ใหม่ (server + contract doc) | 4–6 |
| Flex message ใหม่ 1 แบบ | 4–8 (ปรับหลายรอบเป็นเรื่องปกติในระบบนี้) |
| แก้บั๊กที่รู้สาเหตุแล้ว | 2–4 |
| แก้บั๊กที่ยังไม่รู้สาเหตุ | ตั้ง timebox สืบสวน 4 ชม. แล้วประเมินใหม่ |
| งานใน `line.constroller.js` | +30% เพราะไฟล์ใหญ่และมีโค้ดซ้ำหลายจุด |

Buffer ตามมาตรฐาน GoAlong: +20% ลูกค้า SME, +15% requirement ไม่ชัด, +25% เทคโนโลยีใหม่

## Phase 4 — ความเสี่ยงประจำ repo นี้

ระบุในแผนทุกครั้งถ้าเกี่ยว:
- งานที่แตะ socket contract → ต้อง sync กับทีม CRM/RN ในสัปดาห์เดียวกัน ไม่งั้น deploy ไม่ได้
- งานที่ต้องพึ่ง SP ใหม่ → ถูก block โดย `coreapi-new` ต้องขึ้น task ที่นั่นก่อนและเผื่อเวลารอ
- งานที่ต้องทดสอบกับ LINE จริง → ต้องขออนุญาตและใช้ OA ทดสอบ ไม่ยิงลูกค้า
- งานที่ scale หลาย replica → memory state / cron ซ้ำ ต้องออกแบบก่อนลงมือ

## Phase 5 — output

```
Sprint: <ชื่อ> (<วันเริ่ม> – <วันจบ>)
เป้าหมาย: ...

| # | Task | ชั้น | ไฟล์หลัก | ชั่วโมง | ผู้รับผิดชอบ | ขึ้นกับ |
|---|------|-----|---------|--------|------------|--------|

รวม: XX ชม. · capacity: YY ชม. · เหลือ buffer: ZZ ชม.

ความเสี่ยง:
1. ...

นอก sprint (ต้องให้ทีมอื่นทำก่อน):
1. coreapi-new — ...
```

ปิดท้ายด้วยลำดับการลงมือ (task ไหนก่อนหลัง) และจุดที่ต้อง demo ให้ลูกค้าเห็นระหว่างทาง
