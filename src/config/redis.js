require("dotenv").config();
const { createClient } = require("redis");

// ตอน boot: retry เท่านี้แล้วยอมแพ้ → connect() reject → app.js process.exit(1) (เหมือนเดิมก่อนมี error listener)
const REDIS_CONNECT_MAX_RETRIES = 10;
// หลุดระหว่างรัน: retry ไม่สิ้นสุด แต่ถ่างช่วงสูงสุดที่ค่านี้
const REDIS_RECONNECT_MAX_DELAY_MS = 5000;
// ระหว่างล่ม log error ซ้ำไม่ถี่กว่านี้ (กัน log ท่วมทุกรอบ retry)
const REDIS_ERROR_LOG_INTERVAL_MS = 30 * 1000;

// client สำหรับคำสั่งทั่วไป (lock / dedupe) — แยกจาก pub/sub ของ socket.io adapter
let cmdClient = null;

/**
 * สร้าง redis client พร้อม password (optional), reconnect strategy และ event log
 * - REDIS_PASSWORD ไม่ตั้ง/ว่าง = ไม่ส่ง AUTH (เหมือนเดิม)
 * - error listener กัน process crash ตอนเครือข่ายสะดุด
 * @param {string} name ชื่อไว้แสดงใน log (pub / sub / cmd)
 * @returns {import("redis").RedisClientType}
 */
function createNamedClient(name) {
  const state = { hasBeenReady: false, down: false, lastErrorLogAt: 0 };

  const client = createClient({
    url: `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`,
    password: process.env.REDIS_PASSWORD || undefined,
    socket: {
      /**
       * @param {number} retries จำนวนครั้งที่ retry ไปแล้วในรอบนี้
       * @returns {number|Error} ms ที่จะรอก่อน retry หรือ Error เพื่อยอมแพ้
       */
      reconnectStrategy: (retries) => {
        if (!state.hasBeenReady) {
          if (retries >= REDIS_CONNECT_MAX_RETRIES) {
            return new Error(
              `[Redis:${name}] connect failed after ${retries} retries`,
            );
          }
          return (retries + 1) * 100; // รวม ~5.5 วินาทีก่อนยอมแพ้
        }
        return Math.min((retries + 1) * 200, REDIS_RECONNECT_MAX_DELAY_MS);
      },
    },
  });

  client.on("error", (err) => {
    const now = Date.now();
    if (!state.down || now - state.lastErrorLogAt >= REDIS_ERROR_LOG_INTERVAL_MS) {
      console.error(`[Redis:${name}] error:`, err?.message || String(err));
      state.lastErrorLogAt = now;
    }
    state.down = true;
  });

  client.on("reconnecting", () => {
    if (!state.down) console.warn(`[Redis:${name}] reconnecting...`);
    state.down = true;
  });

  client.on("ready", () => {
    if (state.hasBeenReady) console.log(`[Redis:${name}] ready (reconnected)`);
    state.hasBeenReady = true;
    state.down = false;
    state.lastErrorLogAt = 0;
  });

  return client;
}

/**
 * เชื่อมต่อ Redis: pub/sub สำหรับ socket.io adapter + cmdClient สำหรับ lock/dedupe
 * @returns {Promise<{pubClient: import("redis").RedisClientType, subClient: import("redis").RedisClientType, cmdClient: import("redis").RedisClientType}>}
 */
async function connectRedis() {
  const pubClient = createNamedClient("pub");
  const subClient = createNamedClient("sub");
  const client = createNamedClient("cmd");

  await pubClient.connect();
  await subClient.connect();
  await client.connect();
  cmdClient = client;
  console.log(
    `[Redis] connected (auth: ${process.env.REDIS_PASSWORD ? "on" : "off"})`,
  );

  return { pubClient, subClient, cmdClient: client };
}

/**
 * คืน cmdClient ถ้าพร้อมใช้งาน ไม่งั้นคืน null (ให้ผู้เรียก fallback เอง)
 * @returns {import("redis").RedisClientType|null}
 */
function getRedis() {
  return cmdClient && cmdClient.isReady ? cmdClient : null;
}

module.exports = {
  connectRedis,
  getRedis,
};
