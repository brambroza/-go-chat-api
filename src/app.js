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
const { createClient } = require("redis");
const { createAdapter } = require("@socket.io/redis-adapter");

const ticketTaskReplyHub = require("./controllers/localchat.controller");
const { waitsendmsgagent } = require("./controllers/line.constroller"); // ปรับ path ให้ตรงจริง
const {
  JobGetLineFriend,
  JobGetLineFriendNotProfile,
} = require("./controllers/chat.controller");

const { setIO } = require("./utils/socket");

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

const routes = require("./routes");
const os = require("os");

// test loadbanlance get name service
/* 
app.use("/" , async(req ,res) => {
    res.json({message: "Responsefrom: " , hostname : `${os.hostname}`})
}) */

// ผูก routes
app.use("/api", routes);

let isRunningJobGetLineFriend = false;

async function runJobGetLineFriend(reason = "manual") {
  if (isRunningJobGetLineFriend) {
    console.log("⏭️ JobGetLineFriend already running, skip:", reason);
    return;
  }
  isRunningJobGetLineFriend = true;

  console.log(
    `⏱ Run job: JobGetLineFriend() [${reason}] at`,
    new Date().toISOString(),
  );
  try {
    await JobGetLineFriend();
  } catch (err) {
    console.error("JobGetLineFriend error:", err);
  } finally {
    isRunningJobGetLineFriend = false;
  }
}

// ✅ รันครั้งแรกทันทีตอน start
runJobGetLineFriend("startup");

// ⏱ Cron: เรียกทุก 1 นาที
cron.schedule("* * * * *", async () => {
  console.log("⏱  Run job: waitsendmsgagent()");
  try {
    await waitsendmsgagent();
  } catch (err) {
    console.error("Cron waitsendmsgagent error:", err);
  }
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
  console.log("⏱ Run job: JobGetLineFriendNotProfile()");

  try {
    await JobGetLineFriendNotProfile();
  } catch (err) {
    console.error("Cron JobGetLineFriendNotProfile error:", err);
  } finally {
    isJobRunning = false;
  }
});

cron.schedule(
  "0 0 * * *", // ทุกวัน 00:00
  async () => {
    console.log("⏱ Run job: JobGetLineFriend() at", new Date().toISOString());
    try {
      await JobGetLineFriend();
    } catch (err) {
      console.error("Cron JobGetLineFriend error:", err);
    }
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
    const pubClient = createClient({
      url: `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`,
    });
    const subClient = pubClient.duplicate();
    await pubClient.connect();
    await subClient.connect();
    console.log("[Redis] connected");

    io.adapter(createAdapter(pubClient, subClient));

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

      socket.on("joinRoom", ({ cmpid, userlogin }) => {
        const room = `notification_${cmpid}_${userlogin}`;
        socket.join(room);
        console.log(`👥 ${userlogin} joined ${room}`);
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
