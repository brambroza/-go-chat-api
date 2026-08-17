# CLAUDE.md — go-chat-api (GoAlong Chat & Realtime Bridge)

คำสั่งสำหรับ Claude Code เมื่อทำงานใน repo นี้ ไฟล์นี้มีลำดับสูงกว่า default behavior
บทบาทและการเลือก agent ดู [.claude/ROLES.md](.claude/ROLES.md)

---

## 1. ตัวตนของโปรเจค

| หัวข้อ | ค่า |
| --- | --- |
| ชื่อ package | `go-chat-api` |
| Runtime | Node.js 18 (Docker `node:18-alpine`) — local dev เครื่องนี้ Node 24 |
| ภาษา | **JavaScript CommonJS (`require`) เท่านั้น** — ไม่มี TypeScript, ไม่มี build step |
| Framework | Express 4 + Socket.IO 4 + `@socket.io/redis-adapter` |
| Database | SQL Server (`mssql`) — เรียกผ่าน **stored procedure ของ coreapi** เป็นหลัก |
| Queue | RabbitMQ (`amqplib`) — ใช้กับ webhook ของ FB / WhatsApp / Shopee / Lazada / TikTok |
| Cache / Pub-Sub | Redis — ใช้เป็น Socket.IO adapter (scale หลาย instance) |
| Entry point | `src/app.js` (ทั้ง HTTP + Socket.IO + cron อยู่ในไฟล์เดียว) |
| Base path | REST = `/api/...` · Socket.IO path = `/socketionode` · Swagger = `/api-docs` |
| Repo | https://github.com/brambroza/-go-chat-api — branch หลัก `main` |
| Deploy | GitHub Actions (`.github/workflows/docker-image.yml`) build+push image `nohservdoc/go-chat-api` ทุกครั้งที่ push `main` |

### ตำแหน่งในระบบ GoAlong

```
LINE OA / FB / Shopee / Lazada / TikTok / WhatsApp   (webhook เข้า)
                    │
                    ▼
              go-chat-api  ──socket.io──►  go-crm-24v4 (CRM web, default namespace)
                    │       ──socket.io──►  NIS-OnsiteService (RN app, namespace /nis)
                    │
                    ├──► SQL Server (stored procedure ของ coreapi)
                    └◄── coreapi-new เรียก POST /api/nis/realtime/notify (internal bridge)
```

**ผลกระทบข้ามระบบ:** เปลี่ยนชื่อ socket event, ชื่อห้อง, รูป payload หรือ route ใด ๆ
= พัง `go-crm-24v4` และ/หรือ `NIS-OnsiteService` ทันที — ต้องขออนุญาตและแก้ฝั่ง client พร้อมกัน

---

## 2. Module map — ใช้หาไฟล์ก่อนเริ่มงาน

| Domain | ไฟล์หลัก |
| --- | --- |
| LINE chat inbound (webhook) | `src/controllers/chat.controller.js` → `handleLineWebhook` |
| LINE chat outbound + history | `src/controllers/chat.controller.js` (`sendMessage`, `getMessages`, `getLineChatConvertsatition`, `getChatConvertsationUserId`, `setReadLineMsg`) |
| LINE helpdesk / LIFF / Flex | `src/controllers/line.constroller.js` (**~4,100 บรรทัด — ใหญ่และเสี่ยงสุดใน repo**) |
| LINE API client | `src/services/line.service.js` (`replyMessage`, `pushMessage`, `getLineProfileWithRetry`, `downloadImage`, `downloadVideo`) |
| NIS realtime (RN app) | `src/sockets/nis.namespace.js`, `src/controllers/nisrealtime.controller.js`, `src/services/nischat.service.js` |
| CRM realtime เดิม | `src/app.js` (`joinRoom`), `src/controllers/localchat.controller.js` |
| Marketplace / social อื่น | `src/controllers/{fb,whatsapp,shopee,lazada,tiktok}.controller.js` + service คู่กัน (ยังเป็นโครงบาง ๆ ส่งเข้า queue) |
| Auth ของ chat เอง | `src/controllers/auth.controller.js`, `src/middlewares/auth.middleware.js`, `src/utils/jwt.util.js` |
| Auth ของ NIS (token coreapi) | `src/middlewares/nisauth.middleware.js`, `src/utils/nisjwt.util.js` |
| Dashboard config | `src/controllers/dashboard.config.controller.js` |
| Service ticket bridge / short URL | `src/controllers/service.controller.js` |
| Video thumbnail (ffmpeg + sharp) | `src/services/thumb.service.js` |
| Infra config | `src/config/{database,rabbitmq,swagger}.js`, `src/utils/socket.js` |

### Route map (`src/routes/index.js` mount ใต้ `/api`)

| Prefix | ไฟล์ | Auth |
| --- | --- | --- |
| `/api/auth` | `auth.routes.js` | ไม่มี (register / login) |
| `/api/chat` | `chat.routes.js` | `authMiddleware` (JWT ของ chat) |
| `/api/dashboard` | `config.routes.js` | `authMiddleware` |
| `/api/line` | `line.routes.js` | **ไม่มี** — webhook + LIFF endpoint |
| `/api/service` | `service.router.js` | **ไม่มี** |
| `/api/nis` | `nis.routes.js` | `nisauth` (JWT coreapi) ยกเว้น `/realtime/notify` = header `x-internal-secret` |
| `/api/{fb,whatsapp,shopee,lazada,tiktok}` | ตามชื่อไฟล์ | verify token ของแต่ละแพลตฟอร์ม |

ที่ไม่มี auth คือ**ของเดิมที่ตั้งใจไว้แบบนั้น** (platform เรียกเข้ามาเอง / LIFF ยิงจากเบราว์เซอร์ผู้ใช้)
— ห้ามใส่ `authMiddleware` เพิ่มเองโดยไม่ถาม

---

## 3. Socket.IO contract — ห้ามแก้โดยไม่ได้รับอนุญาต

Socket.IO path = `/socketionode` (ตรงกับ client ฝั่ง React) · CORS origin whitelist hardcode ที่ `src/app.js`

### 3.1 Default namespace `/` — CRM web (`go-crm-24v4`)

| ทิศทาง | Event | Payload |
| --- | --- | --- |
| client→server | `joinRoom` | `{ cmpid, userlogin }` → join ห้อง `notification_{cmpid}_{userlogin}` |
| server→client | `ReceiveNotification` | **`JSON.stringify([msgNotification])`** — string ของ array ไม่ใช่ object |
| server→client | `server_broadcast` | ข้อความ chat ใหม่ (LINE inbound / outbound) |
| server→client | `helpdesk:new` / `helpdesk:update` | broadcast ทั้งระบบ (ไม่จำกัดห้อง) |
| client↔server | `JoinTicketGroup` / `LeaveTicketGroup` / `SendMessage` | ticket task reply hub (`localchat.controller.js`) |
| server→client | `ReceiveTicketTaskReply{CmpId}{TicketId}{RouteId}{RemindId}` | ชื่อ event ประกอบจาก field ของ message — ต่อ string ตรงกับ CRM |

### 3.2 Namespace `/nis` — RN app (`NIS-OnsiteService`) contract v1

- handshake auth: `{ token (JWT coreapi), cmpid, fullName }` — ไม่ผ่าน = ปฏิเสธตอน connect
- client→server: `nis:chat:join` / `nis:chat:leave` `{ ticketId }` · `nis:chat:send` `{ ticketId, text, tempId }` (มี ack)
- server→client: `nis:chat:message` `{ id, ticketId, sender, senderName, text, at }` · `nis:notify` `{ type, ticketId, title, body, at }`
- ห้อง: `nischat_{cmpid}_{ticketId}` · `nisuser_{cmpid}_{userlogin}` (auto-join ตอน connect)
- `sender` มาจาก JWT (`decoded.sub`) เท่านั้น — **ห้ามรับผู้ส่งจาก payload ของ client**
- ผู้ส่งได้ผลผ่าน `ack` ไม่ echo กลับ (ใช้ `socket.to(room)` ไม่ใช่ `nis.to(room)`)
- ทุกอย่างของ NIS อยู่ใน `src/sockets/nis.namespace.js` — ห้ามเอา logic NIS ไปปนใน default namespace

เวลาในฝั่ง NIS = ISO 8601 `+07:00` ผ่าน `nowIsoBangkok()` ของ `nischat.service.js` — ห้ามใช้ `new Date().toISOString()`

---

## 4. กฎการเขียนโค้ดใน repo นี้

### 4.1 ภาษาและสไตล์

- **JavaScript CommonJS เท่านั้น** — ห้ามแปลงไฟล์เป็น TypeScript, ห้ามเปลี่ยนเป็น ESM `import`
  (ข้อนี้ override default ของ global CLAUDE.md ที่ให้ใช้ TypeScript)
- ตาม pattern ไฟล์ข้างเคียง: `exports.fnName = async (req, res) => {}` ใน controller,
  `exports.fn` หรือ `module.exports = { ... }` ใน service
- ฟังก์ชันใหม่ต้องมี JSDoc (`@param` / `@returns`)
- Comment เป็นภาษาไทยได้ (ทั้ง repo เป็นแบบนั้น)
- แก้แบบ **minimal diff** — ห้าม reformat หรือ refactor โค้ดรอบข้างที่ไม่เกี่ยวกับ task

### 4.2 Data access

- ทุก query ต้อง parameterized ด้วย `pool.request().input(...)` แล้ว `.execute("dbo.xxx")`
  หรือ `.query("EXEC dbo.xxx @p=@p")` — **ห้าม string concat ค่าจาก user ลง SQL**
  (ในโค้ดเก่ามีตัวอย่าง concat ที่ comment ทิ้งไว้ — อย่าเอากลับมาใช้)
- ระบุ type + ความยาวให้ตรง เช่น `sql.VarChar(50)`, `sql.NVarChar(sql.MAX)` สำหรับข้อความไทย
- Stored procedure ส่วนใหญ่เป็นของ **coreapi / DBA** — repo นี้เป็นผู้เรียก
  ถ้าต้องเพิ่ม/แก้ SP หรือ schema: **หยุด แล้วแจ้งผู้ใช้** ให้ไปทำที่ `coreapi-new` (`Database/Migrations/`)
- ตารางที่ repo นี้ query ตรง: `dbo.CompanySocialChannel` (หา `AccessToken` ตาม `Name`=accountId),
  `dbo.Accounts`, `dbo.Dashboard_Service_Configs`, `dbo.NisChatMessages`
- SP ที่ใช้บ่อย: `setLineChatMessage`, `getLineChatConvertsatition`, `getLineChatConvertsatitionUserId`,
  `getLineFriend`, `getLineFriendNotProfile`, `getLineFriendUserId`, `UpsertLineProfileCache`,
  `getAccountlist`, `setNotification`, `setNotificationLineChat`, `setReadLineMsg`,
  `setServiceFormLiFF`, `getServiceFormLiFFWaiting`, `setServiceFormMarkNotified`,
  `setContactFormLiff`, `setContactFormLiffCheck`, `setProblemRating`, `setSTProblemFiles`,
  `getServiceTeam`, `getServiceTeamClose`, `setService_Assign_Chang`, `UpsertDashboardServiceConfig`

### 4.3 Secret และ config

- ทุกค่า secret อ่านจาก `process.env` เท่านั้น — **ห้าม hardcode** และห้าม log ค่าออกมา
- `.env` อยู่ใน `.gitignore` แล้ว — ห้าม commit, ห้าม echo/cat เนื้อหาออกใน output
- env ที่ระบบใช้: `PORT`, `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`,
  `JWT_SECRET`, `JWT_Issuer`, `JWT_Audience`, `JWT_NIS_SECRET`, `NIS_INTERNAL_SECRET`,
  `RABBITMQ_URL`, `REDIS_HOST`, `REDIS_PORT`,
  `FB_VERIFY_TOKEN`, `FB_PAGE_ACCESS_TOKEN`, `WHATSAPP_TOKEN`, `WHATSAPP_VERIFY_TOKEN`,
  `WHATSAPP_PHONE_NUMBER_ID`, `SHOPEE_SECRET`, `CLIENT_ID`, `CLIENT_SECRET`, `REDIRECT_URI`, `REFRESH_TOKEN`
- ถ้าเพิ่ม env ใหม่: ต้องบอกผู้ใช้ให้ไปตั้งบน server ด้วย และเขียน fallback/ปิดฟีเจอร์ให้ปลอดภัยเมื่อไม่ได้ตั้ง
  (ดูตัวอย่าง `NIS_INTERNAL_SECRET` → ถ้าไม่ตั้ง endpoint ตอบ 503 ไม่ใช่เปิดโล่ง)

### 4.4 Webhook

- ตอบ `200` ให้ platform **เร็วที่สุด** แล้วค่อยประมวลผลต่อ (`process.nextTick`) — กัน LINE retry ยิงซ้ำ
- ต้อง idempotent: กันซ้ำด้วย `messageId` ทั้งใน request เดียวกัน (`Set`) และข้าม request
  (`recentLineMsgIds` TTL 5 นาที ใน `chat.controller.js`)
- error ใน background ต้อง `try/catch` + log — ห้ามให้ throw หลุดจนโปรเซสตาย

### 4.5 ไฟล์อัปโหลด

- base path hardcode `/usr/src/app/uploads` (ตรงกับ docker volume) — บนเครื่อง dev path นี้ไม่มี
  `line.constroller.js` เรียก `fs.mkdirSync` ตอน require ถ้าสร้างไม่ได้จะพังตอน start
- ชื่อไฟล์ใหม่ต้องผ่าน `sanitizeFileName` (uuid + extension เดิม) — ห้ามใช้ `file.originalname` ตรง ๆ
- LINE inbound media เก็บที่ `/usr/src/app/uploads/{cmpId}/linechat/{messageId}{ext}` · helpdesk ที่ `uploads/helpdesk`

---

## 5. Known debt และกับดัก (อ่านก่อนแก้)

| เรื่อง | รายละเอียด | ต้องทำอย่างไร |
| --- | --- | --- |
| `cmpId` hardcode `"230015"` | อยู่ใน `chat.controller.js` (11 จุด) และ `line.constroller.js` (5 จุด) | ระบบยัง single-tenant อยู่จริง — ห้ามแก้เป็น dynamic ทั้งชุดโดยไม่มี CR |
| `line.constroller.js` (สะกดผิดจาก controller) | ~4,100 บรรทัด รวม Flex message, LIFF, helpdesk, assign, cron | อย่าเปลี่ยนชื่อไฟล์ (มี require หลายที่) · แก้เฉพาะฟังก์ชันที่เกี่ยว · อ่านฟังก์ชันข้างเคียงก่อน |
| Flex message ต่อ JSON ยาวมาก | ประวัติ commit ส่วนใหญ่คือแก้ Flex ทีละรอบ | copy โครงจาก Flex ที่ทำงานอยู่แล้วในไฟล์เดียวกัน อย่าเขียนใหม่จากศูนย์ |
| state ใน memory ไม่ shared | `recentLineMsgIds` (dedupe), `memStore` (nischat fallback), flag `isRunningJobGetLineFriend` | เป็น per-instance เท่านั้น ถ้ารันหลาย replica จะไม่ป้องกันข้าม instance — ถ้าต้องกันข้าม instance ต้องใช้ Redis |
| cron อยู่ใน `app.js` | 3 job: `waitsendmsgagent` (ทุกนาที), `JobGetLineFriendNotProfile` (ทุกนาที), `JobGetLineFriend` (00:00 Asia/Bangkok + ตอน start) | ทุก replica รันเองทั้งหมด = งานซ้ำ ถ้า scale ต้องคุยก่อน |
| `thumb.service.js` | ประกาศ `createThumbForLocalMp4` **ซ้ำ 2 ครั้ง** (บรรทัด 298 และ 384) ตัวหลังทับตัวแรก | แก้ที่ตัวบรรทัด 384 (ตัวที่ถูกใช้จริง) และรายงานความซ้ำนี้ให้ผู้ใช้ทราบ |
| `sql.connected` ใน `database.js` | เช็คแบบนี้ไม่ค่อยตรง อาจ connect ซ้ำ | ไม่ใช่บั๊กเร่งด่วน อย่าแก้พ่วงกับ task อื่น |
| ไม่มี test | `npm test` ตั้งใจให้ fail | verify ด้วย `node --check` + ยิง endpoint จริง (ดู `/chat-verify`) |
| ไม่มี validation library | validate มือใน controller | ของใหม่ต้อง validate ครบ: มีค่าไหม, type, ความยาวสูงสุด (ดู `MAX_TEXT_LEN` ใน nis.namespace เป็นตัวอย่าง) |
| URL ภายนอก hardcode | `erp.nisolution.co.th`, `api.nisolution.co.th`, `liff.line.me/...`, `is.gd` | ของใหม่ให้ย้ายไป env ถ้าเป็นไปได้ แต่อย่าไปแก้ของเดิมพ่วง |

---

## 6. คำสั่งที่ใช้บ่อย

```bash
npm install
npm run dev          # nodemon src/app.js
npm start            # node src/app.js
node --check src/controllers/chat.controller.js   # ตรวจ syntax ไฟล์ที่แก้ (แทนการ build)

# Swagger: http://localhost:3000/api-docs
docker compose up --build    # api + nginx (conf.d/)
```

ต้องมี MSSQL, Redis, RabbitMQ ที่เข้าถึงได้ตาม `.env` ถึงจะ start ผ่าน
(Redis ล้ม = start ไม่ผ่าน เพราะ `app.js` `process.exit(1)`; RabbitMQ ล้ม = log error แต่ไปต่อได้)

---

## 7. Definition of Done

1. `node --check` ผ่านทุกไฟล์ที่แก้ และ start ได้ (`npm run dev`) ไม่มี error ใหม่ตอน boot
2. ฟังก์ชันใหม่มี JSDoc + input validation ครบ
3. Query ทั้งหมด parameterized · ไม่มี secret ใน diff หรือใน log
4. socket event / ห้อง / route / response shape เดิมไม่เปลี่ยน (ถ้าเปลี่ยน = ระบุชัดว่ากระทบ client ตัวไหนและต้องแก้อะไร)
5. Webhook ที่แตะยังตอบ 200 เร็วและ idempotent อยู่
6. ถ้าต้องมี SP/schema ใหม่ → บอกให้ไปทำที่ `coreapi-new` และระบุว่ายังไม่ได้ทำ
7. สรุปงานเป็นภาษาไทย: แก้อะไร ไฟล์ไหนบรรทัดไหน ทดสอบยังไง อะไรยังไม่ได้ทำ

---

## 8. ข้อห้ามเด็ดขาดใน repo นี้

- ห้าม commit / push / deploy โดยไม่ได้รับคำสั่ง (push `main` = build image production ทันที)
- ห้ามแก้ `.env`, `docker-compose.yml`, `conf.d/`, `.github/workflows/` โดยไม่แจ้ง
- ห้ามลบไฟล์หรือ `rm -rf` · ห้ามลบไฟล์ใน `uploads/`
- ห้ามรัน SQL ที่เปลี่ยนข้อมูล/schema บน DB จริง
- ห้ามเปลี่ยน socket contract, ชื่อห้อง, `path: "/socketionode"` โดยไม่ได้ approve
- ห้ามยิง LINE Messaging API จริง (push/reply) เพื่อทดสอบ โดยไม่ได้ขออนุญาต — ผู้ใช้ปลายทางเห็นข้อความ
