const os = require("os");
const crypto = require("crypto");
const { getRedis } = require("../config/redis");

// prefix กันชนกับ key ของ coreapi (goalongapi) และ socket.io adapter (socket.io#) ที่ใช้ Redis ตัวเดียวกัน
const KEY_PREFIX = "gochat:";

// ลบ lock เฉพาะเมื่อ token ยังเป็นของเรา (กันลบ lock ของ instance อื่นหลัง TTL หมด)
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

/**
 * สร้าง token เฉพาะ instance + ครั้งที่ขอ lock
 * @returns {string}
 */
function newToken() {
  return `${os.hostname()}:${process.pid}:${crypto.randomBytes(6).toString("hex")}`;
}

/**
 * ขอ lock แบบ SET NX PX
 * @param {import("redis").RedisClientType} client redis client
 * @param {string} key key เต็ม (รวม prefix)
 * @param {number} ttlMs อายุ lock (ms)
 * @returns {Promise<string|null>} token ถ้าได้ lock, null ถ้ามีคนถืออยู่
 */
async function tryAcquire(client, key, ttlMs) {
  const token = newToken();
  const ok = await client.set(key, token, { NX: true, PX: ttlMs });
  return ok === "OK" ? token : null;
}

/**
 * ปล่อย lock ถ้ายังเป็นของเรา — error ไม่โยนต่อ (lock จะหมดเองตาม TTL)
 * @param {import("redis").RedisClientType} client redis client
 * @param {string} key key เต็ม (รวม prefix)
 * @param {string} token token ที่ได้ตอน acquire
 * @returns {Promise<void>}
 */
async function release(client, key, token) {
  try {
    await client.eval(RELEASE_SCRIPT, { keys: [key], arguments: [token] });
  } catch (err) {
    console.error(`[lock] release ${key} failed:`, err?.message || err);
  }
}

/**
 * slot ของ cron รายนาที (เลขนาทีนับจาก epoch)
 * @param {Date} [now] เวลาอ้างอิง
 * @returns {string}
 */
function minuteSlot(now = new Date()) {
  return String(Math.floor(now.getTime() / 60000));
}

/**
 * slot ของ cron รายวัน = วันที่เวลาไทย YYYYMMDD
 * @param {Date} [now] เวลาอ้างอิง
 * @returns {string}
 */
function bangkokDaySlot(now = new Date()) {
  const bkk = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return bkk.toISOString().substring(0, 10).replace(/-/g, "");
}

/**
 * รันงาน cron ให้มี instance เดียวที่ทำงานต่อ tick (และไม่ซ้อนรอบที่ยังไม่จบ ข้าม instance)
 * - slot: ระบุ tick (เช่น minuteSlot()) → claim ครั้งเดียวต่อ slot ไม่ปล่อย key; ไม่ระบุ = ใช้ running lock อย่างเดียว
 * - Redis ไม่พร้อม/error → skip รอบนั้น (fail-closed) กันส่งข้อความซ้ำ
 * @param {string} jobName ชื่องาน (ใช้เป็นส่วนของ key)
 * @param {{slot?: string, slotTtlSec?: number, lockTtlMs: number}} opts ตัวเลือก lock
 * @param {() => Promise<void>} fn งานที่จะรัน
 * @returns {Promise<boolean>} true ถ้า instance นี้ได้รันงาน
 */
async function runCronExclusive(jobName, opts, fn) {
  const { slot, slotTtlSec = 120, lockTtlMs } = opts || {};
  const client = getRedis();
  if (!client) {
    console.warn(`⏭ Skip ${jobName}: Redis not ready`);
    return false;
  }

  const runningKey = `${KEY_PREFIX}cron:${jobName}:running`;
  let token = null;
  try {
    if (slot) {
      const tickKey = `${KEY_PREFIX}cron:${jobName}:tick:${slot}`;
      const claimed = await client.set(tickKey, newToken(), {
        NX: true,
        EX: slotTtlSec,
      });
      if (claimed !== "OK") return false; // instance อื่นรับ tick นี้แล้ว
    }

    token = await tryAcquire(client, runningKey, lockTtlMs);
    if (!token) {
      console.log(`⏭ Skip ${jobName}: previous run still in progress`);
      return false;
    }
  } catch (err) {
    console.error(`⏭ Skip ${jobName}: lock error`, err?.message || err);
    return false;
  }

  try {
    await fn();
  } finally {
    await release(client, runningKey, token);
  }
  return true;
}

module.exports = {
  KEY_PREFIX,
  runCronExclusive,
  minuteSlot,
  bangkokDaySlot,
};
