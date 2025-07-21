require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const morgan = require("morgan");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const { connectDB } = require("./config/database");
const { initRabbitMQ } = require("./config/rabbitmq");
const { setupSwagger } = require("./config/swagger");

// Redis Adapter
const { createClient } = require("redis");
const { createAdapter } = require("@socket.io/redis-adapter");

const ticketTaskReplyHub = require("./controllers/localchat.controller");

const app = express();

// Middleware
app.use(morgan("dev"));
app.use(cors());
app.use(bodyParser.json());

// สร้าง server + Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // หรือ URL frontend เช่น 'http://localhost:5173'
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// export io เพื่อให้ controller อื่นเรียกใช้ได้
module.exports.io = io;

const routes = require("./routes");

// ผูก routes
app.use("/api", routes);

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

    /*   setInterval(() => {
        io.emit("server_broadcast", {
          attachments: "-",
          id: "557135566819819521",
          quotaToken:
            "nfo0fqAW1bQVVo5ezb9oUnfl8mpfrWrnICNV6RefQrTZDVL-ZLRDuoI0wH8zlDXf6jwMjyfiEM_EjUWnfUucZVVByc0fHb2oV0SY29aOQv17dd0kdNlkaX968BBJh2kvuVWeAwWJn8E_OFChemidpA",
          replyToken: "55d4f704011c47b39f5e191e017e6486",
          text: "hello test",
          timestamp: "2025-04-17T17:13:00.116Z",
          type: "LINE",
          userId: "Ud6d93b323d8ac8e4856c0084134d5a8a",
        });
      }, 10000); */

      socket.on("client_message", (data) => {
        console.log("client_message from Flutter:", data);
        io.emit("server_broadcast", {
          from: socket.id,
          text: data,
          timestamp: new Date().toISOString(),
        });
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
