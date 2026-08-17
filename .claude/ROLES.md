# ROLES — go-chat-api (Chat & Realtime Bridge)

ตารางบทบาทสำหรับสั่งงานผ่าน Claude Code ใน repo นี้
ใช้คู่กับ [../CLAUDE.md](../CLAUDE.md) และ agent ใน [agents/](agents/)

---

## 1. Role matrix

| Role | Agent | ขอบเขต | ห้ามทำ |
| --- | --- | --- | --- |
| **Backend Developer** | `chat-backend` | Controller, service, route, business logic, การเรียก stored procedure, validation | เปลี่ยน socket contract, แก้ schema/SP, deploy |
| **LINE / Social Integration** | `chat-line` | LINE webhook, Flex message, LIFF endpoint, helpdesk flow, media download, marketplace webhook (FB/Shopee/Lazada/TikTok/WhatsApp) | ยิง LINE API จริงโดยไม่ขออนุญาต, เปลี่ยน dedupe logic โดยไม่แจ้ง |
| **Realtime & Infra** | `chat-realtime` | Socket.IO namespace/room/event, Redis adapter, RabbitMQ, cron ใน `app.js`, Docker / nginx / CI | เปลี่ยน event หรือชื่อห้องเดิม, deploy, แก้ production config |
| **Code Reviewer** | `chat-reviewer` | Review diff / PR — security, contract breakage, regression, convention | แก้โค้ดเอง (รายงานอย่างเดียว) |
| **Explorer** | `chat-explorer` | ค้นหาโค้ด, map flow, ตอบ "ของนี้อยู่ไหน / ใครเรียก" | แก้ไฟล์ใด ๆ |
| **Project Manager** | `project-manager` (global) | Sprint plan, breakdown, estimate, timeline | ตัดสินใจ technical design |
| **Solution Architect** | `solution-architect` (global) | Architecture decision, tech trade-off | ลงมือ implement เอง |

---

## 2. เลือก role / skill อย่างไร

```
คำสั่งเข้ามา
├── "อยู่ไหน / ใครเรียก / flow เป็นยังไง"          → chat-explorer
├── "วางแผน sprint / ประเมินเวลา"                  → /chat-sprint-plan + project-manager
├── "ทำ feature ตาม spec"                          → /chat-task + chat-backend
├── "แก้บั๊ก / ระบบพัง / ข้อความไม่เข้า"            → /chat-fixbug + agent ตามชั้นที่พัง
├── "เพิ่ม / แก้ REST endpoint"                     → /chat-endpoint + chat-backend
├── "เพิ่ม socket event / notification ไม่เด้ง"      → /chat-socket-event + chat-realtime
├── "แก้ Flex message / LINE ไม่ตอบ / LIFF"         → /chat-line-flex + chat-line
├── "เทสให้แน่ใจก่อนส่ง"                            → /chat-verify
├── "review ให้หน่อย / ก่อน merge"                  → chat-reviewer
├── "SP / ตาราง / column ใหม่"                      → หยุด แจ้งผู้ใช้ ไปทำที่ coreapi-new
└── "ควรออกแบบยังไงดี"                              → solution-architect
```

---

## 3. Escalation

| สถานการณ์ | ต้องแจ้ง / ขอ approve |
| --- | --- |
| ต้องเปลี่ยน socket event, ชื่อห้อง, payload shape | ผู้ใช้ + เจ้าของ client (`go-crm-24v4`, `NIS-OnsiteService`) ก่อนแก้ |
| ต้องเปลี่ยน route หรือ response shape ของ endpoint เดิม | ผู้ใช้ + เจ้าของ client |
| ต้องมี stored procedure / column / ตารางใหม่ | ผู้ใช้ + ทีม DBA — ทำที่ `coreapi-new/Database/Migrations/` ไม่ใช่ repo นี้ |
| ต้องยิง LINE API จริง (push/reply) เพื่อทดสอบ | ผู้ใช้ทุกครั้ง — ลูกค้าปลายทางเห็นข้อความ |
| งานเกิน scope ที่สั่ง | หยุดแล้วเสนอเป็น Change Request ระบุ scope + เวลา + ราคาที่เพิ่ม |
| เจอช่องโหว่ security (auth หลุด, secret รั่ว, SQL concat) | รายงานทันที ก่อนทำงานอื่นต่อ |
| ต้อง deploy / push / commit | ขออนุญาตทุกครั้ง (push `main` = build image production) |
| Blocker กระทบ timeline | แจ้งภายใน 4 ชั่วโมงพร้อมทางเลือก |
| P1 (ข้อความลูกค้าหาย / webhook ตาย / socket ล่ม) | Technical Lead + Management ทันที |

---

## 4. Definition of Done (ทุก role)

ดูรายละเอียดที่ [../CLAUDE.md](../CLAUDE.md) หัวข้อ 7 — สรุป:

1. `node --check` ผ่าน + start ได้ ไม่มี error ใหม่ตอน boot
2. JSDoc + input validation ครบในของใหม่
3. Query parameterized ทั้งหมด · ไม่มี secret ใน diff หรือ log
4. contract เดิม (socket / route / response) ไม่เปลี่ยน หรือระบุผลกระทบชัด
5. Webhook ที่แตะยังตอบ 200 เร็วและ idempotent
6. งานที่ต้องพึ่ง SP/schema ใหม่ ระบุว่ายังไม่ได้ทำและต้องทำที่ไหน
7. สรุปเป็นภาษาไทย: แก้อะไร ไฟล์ไหนบรรทัดไหน ทดสอบยังไง เหลืออะไร
