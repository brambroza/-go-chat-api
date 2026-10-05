require('dotenv').config();
const amqp = require('amqplib');

// หลุดแล้วต่อใหม่เบื้องหลัง: 1s, 2s, 4s ... สูงสุด 30s ไม่สิ้นสุด
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30 * 1000;
// ระหว่างล่ม log error ซ้ำไม่ถี่กว่านี้
const ERROR_LOG_INTERVAL_MS = 30 * 1000;

let connection = null;
let channel = null;
let connectingPromise = null;
let reconnectTimer = null;
let retryCount = 0;
let hasConnectedBefore = false;
let lastErrorLogAt = 0;

/**
 * log error แบบ throttle (ครั้งแรก + ทุก ERROR_LOG_INTERVAL_MS) — log เฉพาะ message ไม่ log URL/credential
 * @param {string} label ข้อความนำหน้า
 * @param {Error} err error ที่เกิด
 * @returns {void}
 */
function logThrottled(label, err) {
  const now = Date.now();
  if (now - lastErrorLogAt >= ERROR_LOG_INTERVAL_MS) {
    console.error(`${label}:`, err?.message || String(err));
    lastErrorLogAt = now;
  }
}

/**
 * ตั้งเวลาต่อใหม่แบบ exponential backoff (มี timer อยู่แล้วไม่ตั้งซ้ำ)
 * @returns {void}
 */
function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = Math.min(
    RECONNECT_BASE_DELAY_MS * 2 ** retryCount,
    RECONNECT_MAX_DELAY_MS
  );
  retryCount += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

/**
 * สร้าง channel บน connection ปัจจุบัน + ผูก event (channel ปิดเองได้จาก channel-level error)
 * @param {import('amqplib').Connection} conn connection ที่จะเปิด channel
 * @returns {Promise<import('amqplib').Channel>}
 */
async function openChannel(conn) {
  const ch = await conn.createChannel();
  ch.on('error', (err) => {
    console.error('RabbitMQ channel error:', err?.message || String(err));
  });
  ch.on('close', () => {
    if (channel === ch) channel = null;
    // connection ยังดี → เปิด channel ใหม่; ถ้า connection ปิดด้วย ให้ handler ของ connection จัดการ
    if (connection === conn) {
      setImmediate(() => {
        if (connection !== conn || channel) return;
        openChannel(conn)
          .then((newCh) => {
            if (connection === conn) channel = newCh;
          })
          .catch((err) => logThrottled('RabbitMQ reopen channel error', err));
      });
    }
  });
  return ch;
}

/**
 * ต่อ RabbitMQ (กันเปิดซ้อนด้วย connectingPromise) — ล้มแล้วตั้ง reconnect เอง ไม่ throw
 * @returns {Promise<import('amqplib').Channel|null>} channel หรือ null ถ้ายังต่อไม่ได้
 */
function connect() {
  if (channel) return Promise.resolve(channel);
  if (connectingPromise) return connectingPromise;

  connectingPromise = (async () => {
    let conn = null;
    try {
      conn = await amqp.connect(process.env.RABBITMQ_URL);
      conn.on('error', (err) => {
        console.error('RabbitMQ connection error:', err?.message || String(err));
      });
      conn.on('close', () => {
        if (connection !== conn) return;
        connection = null;
        channel = null;
        console.warn('RabbitMQ connection closed, reconnecting...');
        scheduleReconnect();
      });

      const ch = await openChannel(conn);
      connection = conn;
      channel = ch;
      retryCount = 0;
      lastErrorLogAt = 0;
      console.log(hasConnectedBefore ? 'RabbitMQ reconnected' : 'RabbitMQ connected');
      hasConnectedBefore = true;
      return channel;
    } catch (error) {
      logThrottled('RabbitMQ connection error', error);
      if (conn) conn.close().catch(() => {});
      scheduleReconnect();
      return null;
    } finally {
      connectingPromise = null;
    }
  })();

  return connectingPromise;
}

/**
 * ต่อ RabbitMQ ตอน start — ไม่ throw (ต่อไม่ได้ = ลองใหม่เองเบื้องหลัง)
 * @returns {Promise<import('amqplib').Channel|null>}
 */
async function initRabbitMQ() {
  return connect();
}

/**
 * ส่งข้อความเข้า queue (durable + persistent)
 * @param {string} queueName ชื่อ queue
 * @param {any} message ข้อมูลที่จะ JSON.stringify
 * @returns {Promise<void>}
 * @throws {Error} ถ้ายังต่อ RabbitMQ ไม่ได้ (caller ตอบ 500 ให้ platform retry)
 */
async function publishToQueue(queueName, message) {
  const ch = channel || (await connect());
  if (!ch) {
    throw new Error('RabbitMQ not connected');
  }
  await ch.assertQueue(queueName, { durable: true });
  ch.sendToQueue(queueName, Buffer.from(JSON.stringify(message)), {
    persistent: true
  });
  console.log(`Message sent to queue ${queueName}`);
}

module.exports = {
  initRabbitMQ,
  publishToQueue
};
