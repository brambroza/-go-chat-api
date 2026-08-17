---
name: chat-line-flex
description: ทำงานกับ LINE ใน go-chat-api — Flex message, reply/push, LIFF endpoint, helpdesk flow, media download ใช้เมื่อข้อความ LINE เพี้ยน ไม่ส่ง หรือต้องเพิ่มข้อความรูปแบบใหม่
---

# LINE Message / Flex — go-chat-api

## Phase 1 — หาจุดที่ต้องแก้

ข้อความ LINE ถูกประกอบไว้หลายที่ใน `src/controllers/line.constroller.js` (~4,100 บรรทัด)
ฟังก์ชันหลัก:

| ฟังก์ชัน | ใช้เมื่อ |
| --- | --- |
| `createHelpdeskCase` | รับเคสใหม่จาก LIFF + แนบไฟล์ |
| `sendLineToTeamSevice` / `...Reply` / `...Waiting` / `...Finish` | แจ้งทีมช่างตามสถานะเคส |
| `sendFlexMsgWaiting` | Flex แจ้งลูกค้าว่ากำลังรอ |
| `sendCaseClosedMessage` | Flex ปิดเคส |
| `rateProblem` | Flex ให้ดาว (ใช้รูป star จาก landpress CDN) |
| `sendmsgtouser` / `sendFromproblem` | ส่งข้อความหาผู้ใช้ปลายทาง |
| `waitsendmsgagent` | cron ทุกนาที ส่งข้อความค้างคิว |

`src/services/line.service.js` = ตัวยิง API จริง (`replyMessage`, `pushMessage`,
`senLinkdMessageProblem`, `getLineProfileWithRetry`, `downloadImage`, `downloadVideo`)

⚠️ ฟังก์ชันเหล่านี้ **มีโครงคล้ายกันหลายตัว** — ก่อนแก้ ให้ Grep ดูว่าปัญหาเดียวกันอยู่กี่จุด แล้วรายงานให้ครบ

## Phase 2 — กฎการเขียน Flex

1. **copy โครงจาก Flex ที่ใช้งานได้อยู่แล้วในไฟล์เดียวกัน** อย่าเขียนใหม่จากศูนย์
2. ตรวจก่อนส่งทุกครั้ง:
   - ทุก `text` ต้องไม่เป็น `""`, `null`, `undefined` (LINE ตอบ 400 ทันที) — ใส่ fallback เช่น `value || "-"`
   - URL รูปต้องเป็น https และเข้าถึงได้จากภายนอก
   - `altText` ต้องมี
   - ความยาว text ไม่เกิน limit ของ LINE
3. ข้อมูลที่มาจาก DB ต้อง `safeStr()` หรือ fallback ก่อนใส่ (เคยมีบั๊ก profile display เป็น null)
4. ถ้าเป็นข้อความมีลิงก์ไป ERP ใช้รูปแบบเดิม `https://erp.nisolution.co.th/productservice/servicerequest/...`
   และย่อ URL ผ่าน `/api/service/shortedurl` ถ้าโค้ดเดิมทำแบบนั้น

## Phase 3 — ทดสอบ

**ห้ามยิง push/reply ไปหาลูกค้าจริงเพื่อทดสอบโดยไม่ขออนุญาตผู้ใช้**

ลำดับที่ปลอดภัย:
1. `console.log(JSON.stringify(flex, null, 2))` แล้วเอาไปวางใน LINE Flex Message Simulator
2. ถ้าต้องยิงจริง — ขออนุญาตก่อน และใช้ OA/บัญชีทดสอบ กับ userId ของทีมเท่านั้น
3. ตรวจ response จาก LINE: 200 = ผ่าน · 400 = payload ผิด (อ่าน `message` ใน body) · 401 = token ผิด/หมดอายุ

## Phase 4 — Webhook inbound (ถ้าเกี่ยว)

ดู `handleLineWebhook` ใน `src/controllers/chat.controller.js` — กฎห้ามพลาด:
- ตอบ 200 ก่อน แล้วทำงานต่อใน `process.nextTick`
- dedupe ด้วย `messageId` (`seenInThisRequest` + `recentLineMsgIds` TTL 5 นาที) — ห้ามถอด
- `channelToken` ดึงจาก `dbo.CompanySocialChannel` ตาม `accountId` — ห้าม hardcode
- media เก็บที่ `/usr/src/app/uploads/{cmpId}/linechat/{messageId}{ext}` แล้วบันทึกผ่าน `dbo.setLineChatMessage`
- วิดีโอสร้าง thumbnail ด้วย `createThumbForLocalMp4` (ระวัง: ฟังก์ชันนี้ประกาศซ้ำ 2 ครั้งใน
  `thumb.service.js` บรรทัด 298 และ 384 — ตัวที่ทำงานจริงคือตัวหลัง)

## Phase 5 — รายงาน

```
เรื่อง:     <ข้อความ/flow ไหน>
แก้:        src/controllers/line.constroller.js:1411 — ...
จุดที่ซ้ำ:  ยังมี pattern เดียวกันที่ :2821, :3172 — ยังไม่แก้ (รอตัดสินใจ)
ทดสอบ:      Flex Simulator ผ่าน / ยิงจริงหา <userId ทีม> ได้ 200
```
