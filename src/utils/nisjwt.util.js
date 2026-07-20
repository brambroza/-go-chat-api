// ══════════════════════════════════════════════════════════════════
// NIS JWT verify (M-RT1) — token ของ NIS Onsite ออกโดย coreapi (HS256)
// ซึ่ง "คนละ secret" กับ JWT_SECRET ของ go-chat-api เอง
//   → verify ด้วย JWT_NIS_SECRET (ต้องตั้ง = jwtSettings.Key ของ coreapi ตอน deploy)
//   → fallback JWT_SECRET เดิม (เผื่อ token ที่ gen จากระบบ chat เอง / local test)
// ⚠️ ห้าม hardcode secret ในไฟล์นี้ทุกกรณี — env เท่านั้น
// ══════════════════════════════════════════════════════════════════
require("dotenv").config();
const jwt = require("jsonwebtoken");

/**
 * verify token NIS — ลอง JWT_NIS_SECRET ก่อน แล้วค่อย JWT_SECRET
 * @param {string} token
 * @returns {object|null} decoded payload (sub/role/aid/sid) หรือ null ถ้าไม่ผ่าน
 */
function verifyNisToken(token) {
  if (!token) return null;
  const secrets = [process.env.JWT_NIS_SECRET, process.env.JWT_SECRET].filter(Boolean);
  for (const secret of secrets) {
    try {
      // ไม่ validate issuer/audience (coreapi กับ chat ตั้งค่าต่างกัน) — เช็คลายเซ็น + exp พอ
      return jwt.verify(token, secret);
    } catch (err) {
      // ลอง secret ถัดไป
    }
  }
  return null;
}

module.exports = { verifyNisToken };
