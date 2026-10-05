require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const morgan = require("morgan");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const cron = require("node-cron");

const { connectDB } = require("./config/database");
const { initRabbitMQ } = require("./config/rabbitmq");
const { setupSwagger } = require("./config/swagger");

// Redis Adapter
const { createAdapter } = require("@socket.io/redis-adapter");
const { connectRedis } = require("./config/redis");
const {
  runCronExclusive,
  minuteSlot,
  bangkokDaySlot,
} = require("./utils/redisLock");

const ticketTaskReplyHub = require("./controllers/localchat.controller");
const { waitsendmsgagent } = require("./controllers/line.constroller"); // ปรับ path ให้ตรงจริง
const {
  JobGetLineFriend,
  JobGetLineFriendNotProfile,
} = require("./controllers/chat.controller");

const { setIO } = require("./utils/socket");
const { registerNisNamespace } = require("./sockets/nis.namespace"); 

const app = express();

// Middleware
app.use(morgan("dev"));
app.use(cors());
app.use(bodyParser.json());

// สร้าง server + Socket.IO
const server = http.createServer(app);

const io = new Server(server, {
  path: "/socketionode", // ต้องตรงกับ React
  cors: {
    origin: ["http://localhost:8080", "https://api.nisolution.co.th"],
    methods: ["GET", "POST"],
    credentials: true,
  },
});

setIO(io);
// export io เพื่อให้ controller อื่นเรียกใช้ได้
module.exports.io = io;

registerNisNamespace(io);

const routes = require("./routes");
const os = require("os");

// test loadbanlance get name service
/* 
app.use("/" , async(req ,res) => {
    res.json({message: "Responsefrom: " , hostname : `${os.hostname}`})
}) */

// ผูก routes
app.use("/api", routes);

const ONE_MINUTE_MS = 60 * 1000;
const JOB_LOCK_TTL_MS = 10 * ONE_MINUTE_MS; // งานรายนาที — กันรอบใหม่ซ้อนรอบเก่า (ข้าม instance)
const LINE_FRIEND_LOCK_TTL_MS = 120 * ONE_MINUTE_MS; // JobGetLineFriend ไล่ทุก friend ใช้เวลานาน

let isRunningJobGetLineFriend = false;

/**
 * รัน JobGetLineFriend โดยมี instance เดียวทำงาน (Redis lock) + กันซ้อนใน instance เดียวกัน
 * @param {string} [reason] เหตุที่เรียก (startup / cron) ไว้แสดงใน log
 * @param {string} [slot] slot ของ tick (cron รายวัน) — ไม่ส่ง = ใช้ running lock อย่างเดียว
 * @returns {Promise<void>}
 */
async function runJobGetLineFriend(reason = "manual", slot) {
  if (isRunningJobGetLineFriend) {
    console.log("⏭️ JobGetLineFriend already running, skip:", reason);
    return;
  }
  isRunningJobGetLineFriend = true;

  try {
    await runCronExclusive(
      "JobGetLineFriend",
      { slot, slotTtlSec: 2 * 24 * 60 * 60, lockTtlMs: LINE_FRIEND_LOCK_TTL_MS },
      async () => {
        console.log(
          `⏱ Run job: JobGetLineFriend() [${reason}] at`,
          new Date().toISOString(),
        );
        try {
          await JobGetLineFriend();
        } catch (err) {
          console.error("JobGetLineFriend error:", err);
        }
      },
    );
  } finally {
    isRunningJobGetLineFriend = false;
  }
}

// ⏱ Cron: เรียกทุก 1 นาที (instance เดียวต่อ tick ผ่าน Redis lock)
cron.schedule("* * * * *", async () => {
  await runCronExclusive(
    "waitsendmsgagent",
    { slot: minuteSlot(), lockTtlMs: JOB_LOCK_TTL_MS },
    async () => {
      console.log("⏱  Run job: waitsendmsgagent()");
      try {
        await waitsendmsgagent();
      } catch (err) {
        console.error("Cron waitsendmsgagent error:", err);
      }
    },
  );
});

let isJobRunning = false;

cron.schedule("* * * * *", async () => {
  if (isJobRunning) {
    console.log(
      "⏭ Skip JobGetLineFriendNotProfile: previous job still running",
    );
    return;
  }

  isJobRunning = true;
  try {
    await runCronExclusive(
      "JobGetLineFriendNotProfile",
      { slot: minuteSlot(), lockTtlMs: JOB_LOCK_TTL_MS },
      async () => {
        console.log("⏱ Run job: JobGetLineFriendNotProfile()");
        try {
          await JobGetLineFriendNotProfile();
        } catch (err) {
          console.error("Cron JobGetLineFriendNotProfile error:", err);
        }
      },
    );
  } finally {
    isJobRunning = false;
  }
});

cron.schedule(
  "0 0 * * *", // ทุกวัน 00:00
  async () => {
    await runJobGetLineFriend("cron", bangkokDaySlot());
  },
  {
    timezone: "Asia/Bangkok", // เวลาไทย
  },
);

// ติดตั้ง swagger
setupSwagger(app);

const PORT = process.env.PORT || 3000;

// เริ่มต้นเชื่อมต่อ MSSQL, RabbitMQ, Redis และ Socket.IO
(async () => {
  try {
    // 1) เชื่อมต่อ MSSQL
    await connectDB();

    // 2) เชื่อมต่อ RabbitMQ (ถ้ามีใช้งาน)
    await initRabbitMQ();

    // 3) เชื่อมต่อ Redis เพื่อใช้เป็น Adapter ของ Socket.IO
    //    (+ client แยกสำหรับ cron lock / dedupe LINE messageId)
    const { pubClient, subClient } = await connectRedis();

    io.adapter(createAdapter(pubClient, subClient));

    // ✅ รัน JobGetLineFriend ครั้งแรกตอน start (หลัง Redis พร้อม — instance เดียวถ้ามีหลาย replica)
    runJobGetLineFriend("startup");

    // 4) ตั้งค่า event ของ Socket.IO
    io.on("connection", (socket) => {
      console.log("A user connected:", socket.id);

      ticketTaskReplyHub(socket);

      socket.on("client_message", (data) => {
        io.emit("server_broadcast", {
          from: socket.id,
          text: data,
          timestamp: new Date().toISOString(),
        });
      });

      /**
       * เข้าห้องแจ้งเตือนของผู้ใช้ — client เรียกใหม่ทุกครั้งที่ต่อติด (รวมตอน reconnect)
       * @param {{cmpid?: string|number, userlogin?: string}} payload ข้อมูลผู้ใช้ที่จะเข้าห้อง
       * @param {(res: {ok: boolean, room?: string, error?: string}) => void} [ack] callback ผลลัพธ์ (ไม่บังคับ)
       * @returns {void}
       */
      socket.on("joinRoom", ({ cmpid, userlogin } = {}, ack) => {
        const cmpIdStr = String(cmpid ?? "").trim();
        const userStr = String(userlogin ?? "").trim();

        if (!cmpIdStr || !userStr || cmpIdStr.length > 50 || userStr.length > 100) {
          if (typeof ack === "function") ack({ ok: false, error: "invalid payload" });
          return;
        }

        const room = `notification_${cmpIdStr}_${userStr}`;

        // ออกจากห้องแจ้งเตือนเดิมก่อน กันค้างหลายห้องตอนสลับผู้ใช้ในแท็บเดิม
        for (const joined of socket.rooms) {
          if (
            joined !== socket.id &&
            joined !== room &&
            joined.startsWith("notification_")
          ) {
            socket.leave(joined);
          }
        }

        socket.join(room);
        if (typeof ack === "function") ack({ ok: true, room });
        console.log(`👥 ${userStr} joined ${room}`);
      });

      socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
      });
    });

    // 5) ใช้ server.listen แทน app.listen
    server.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Startup error:", error);
    process.exit(1);
  }
})();
