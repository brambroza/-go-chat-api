require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const { connectDB } = require('./config/database');
const { initRabbitMQ } = require('./config/rabbitmq');
const { setupSwagger } = require('./config/swagger');

// Redis Adapter
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');


const app = express();

// Middleware
app.use(morgan('dev'));
app.use(cors());
app.use(bodyParser.json());

// สร้าง server + Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

// export io เพื่อให้ controller อื่นเรียกใช้ได้
module.exports.io = io;


const routes = require('./routes');

// ผูก routes
app.use('/api', routes);

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
    const pubClient = createClient({ url: 'redis://192.168.55.219:6379' });
    const subClient = pubClient.duplicate();
    await pubClient.connect();
    await subClient.connect();
    console.log('[Redis] connected');

    io.adapter(createAdapter(pubClient, subClient));

    // 4) ตั้งค่า event ของ Socket.IO
    io.on('connection', (socket) => {
      console.log('A user connected:', socket.id);

      socket.on('client_message', (data) => {
        console.log('client_message from Flutter:', data);
        io.emit('server_broadcast', {
          from: socket.id,
          text: data,
          timestamp: new Date().toISOString(),
        });
      });

      socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
      });
    });

    // 5) ใช้ server.listen แทน app.listen
    server.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });

  } catch (error) {
    console.error('Startup error:', error);
    process.exit(1);
  }
})();
