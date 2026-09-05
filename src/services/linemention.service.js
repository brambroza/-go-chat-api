const axios = require("axios");
const { sql } = require("../config/database");

/**
 * ความยาวสูงสุดของชื่อที่ยอมให้เอาไป mention (ตรงกับความยาวคอลัมน์ใน DB)
 */
const MAX_NAME_LEN = 200;

/**
 * ความยาวสูงสุดของ text message ฝั่ง LINE
 */
const MAX_TEXT_LEN = 5000;

/**
 * หาข้อมูล mention ของผู้ดูแลเคส (LINE userId + ชื่อใน LINE) เพื่อเอาไป mention ในกลุ่ม staff
 *
 * @param {import("mssql").ConnectionPool} pool - connection pool ที่เปิดไว้แล้ว
 * @param {Object} params
 * @param {string} params.lineGroupId - id ของกลุ่มปลายทาง (ค่าเดียวกับที่ push ไป)
 * @param {string} params.assignName - ชื่อผู้ดูแลเคส (assignname จาก dbo.getServiceTeam)
 * @returns {Promise<{lineUserId: string, displayName: string}|null>} ข้อมูล mention หรือ null ถ้ายังไม่ได้ map ไว้
 */
async function getStaffMention(pool, { lineGroupId, assignName } = {}) {
  const groupId = (lineGroupId ?? "").toString().trim();
  const name = (assignName ?? "").toString().trim();

  if (!pool || !groupId || !name) return null;
  if (groupId.length > 100 || name.length > MAX_NAME_LEN) return null;

  const result = await pool
    .request()
    .input("groupId", sql.VarChar(100), groupId)
    .input("assignName", sql.NVarChar(MAX_NAME_LEN), name).query(`
      SELECT TOP 1 LineUserId, LineDisplayName
      FROM [dbo].[LineStaffMention]
      WHERE LineGroupId = @groupId
        AND LTRIM(RTRIM(AssignName)) = @assignName
        AND IsActive = 1
      ORDER BY UpdatedAt DESC
    `);

  if (!result.recordset.length) return null;

  const row = result.recordset[0];
  return {
    lineUserId: row.LineUserId,
    displayName: (row.LineDisplayName ?? "").toString().trim(),
  };
}

/**
 * สร้าง LINE text message ที่ mention ผู้ดูแลเคส
 * (Flex message mention ไม่ได้ — ต้องส่ง text แยกอีก 1 ข้อความในการ push เดียวกัน)
 *
 * ชื่อหลังเครื่องหมาย @ ใช้ชื่อใน LINE ก่อน ถ้าไม่มีค่อยใช้ชื่อในระบบ
 *
 * @param {Object} params
 * @param {string|null} params.lineUserId - LINE userId ของคนที่จะ mention
 * @param {string} params.assignName - ชื่อผู้ดูแลเคสในระบบ (ใช้เมื่อไม่มีชื่อใน LINE)
 * @param {string} [params.displayName] - ชื่อใน LINE ของคนที่จะ mention
 * @param {string} params.headline - ข้อความต่อท้ายชื่อ เช่น "มีเคสใหม่เข้ามา Ticket: TK-0001"
 * @returns {{type: string, text: string, mention: Object}|null} message object หรือ null ถ้า mention ไม่ได้
 */
function buildMentionMessage({
  lineUserId,
  assignName,
  displayName,
  headline,
} = {}) {
  const userId = (lineUserId ?? "").toString().trim();
  const lineName = (displayName ?? "").toString().trim();
  const systemName = (assignName ?? "").toString().trim();
  const name = lineName || systemName;
  const tail = (headline ?? "").toString().trim();

  if (!userId || !name) return null;
  if (name.length > MAX_NAME_LEN) return null;

  const mentionText = `@${name}`;
  const text = tail ? `${mentionText} ${tail}` : mentionText;

  if (text.length > MAX_TEXT_LEN) return null;

  return {
    type: "text",
    text,
    mention: {
      mentionees: [
        {
          // index/length นับเป็น UTF-16 code unit และต้องครอบ "@" + ชื่อ
          index: 0,
          length: mentionText.length,
          type: "user",
          userId,
        },
      ],
    },
  };
}

/**
 * บันทึก/อัปเดต mapping ของสมาชิกกลุ่ม LINE (ไม่แตะ AssignName ที่ map ไว้แล้ว)
 *
 * @param {import("mssql").ConnectionPool} pool - connection pool ที่เปิดไว้แล้ว
 * @param {Object} params
 * @param {string} params.cmpId - รหัสบริษัท
 * @param {string} params.lineGroupId - id ของกลุ่ม
 * @param {string} params.lineUserId - LINE userId ของสมาชิก
 * @param {string} [params.displayName] - ชื่อที่แสดงใน LINE
 * @returns {Promise<boolean>} true ถ้าบันทึกสำเร็จ
 */
async function upsertGroupMember(
  pool,
  { cmpId, lineGroupId, lineUserId, displayName } = {},
) {
  const company = (cmpId ?? "").toString().trim();
  const groupId = (lineGroupId ?? "").toString().trim();
  const userId = (lineUserId ?? "").toString().trim();
  const name = (displayName ?? "").toString().trim().slice(0, MAX_NAME_LEN);

  if (!pool || !company || !groupId || !userId) return false;
  if (groupId.length > 100 || userId.length > 100 || company.length > 30) {
    return false;
  }

  await pool
    .request()
    .input("cmpId", sql.VarChar(30), company)
    .input("groupId", sql.VarChar(100), groupId)
    .input("userId", sql.VarChar(100), userId)
    .input("displayName", sql.NVarChar(MAX_NAME_LEN), name || null).query(`
      IF EXISTS (
        SELECT 1 FROM [dbo].[LineStaffMention]
        WHERE LineGroupId = @groupId AND LineUserId = @userId
      )
        UPDATE [dbo].[LineStaffMention]
        SET LineDisplayName = ISNULL(@displayName, LineDisplayName),
            CmpId = @cmpId,
            UpdatedAt = GETDATE()
        WHERE LineGroupId = @groupId AND LineUserId = @userId;
      ELSE
        INSERT INTO [dbo].[LineStaffMention]
          (CmpId, LineGroupId, LineUserId, LineDisplayName, IsActive, UpdatedAt)
        VALUES (@cmpId, @groupId, @userId, @displayName, 1, GETDATE());
    `);

  return true;
}

/**
 * ดึงโปรไฟล์ของสมาชิกในกลุ่ม LINE
 * (endpoint นี้ใช้ได้กับทุก OA ต่างจาก /members/ids ที่ต้องเป็น verified/premium)
 *
 * @param {string} channelToken - LINE Channel Access Token
 * @param {string} lineGroupId - id ของกลุ่ม
 * @param {string} lineUserId - LINE userId ของสมาชิก
 * @returns {Promise<{displayName: string, userId: string}|null>} โปรไฟล์ หรือ null ถ้าดึงไม่ได้
 */
async function getGroupMemberProfile(channelToken, lineGroupId, lineUserId) {
  if (!channelToken || !lineGroupId || !lineUserId) return null;

  try {
    const res = await axios.get(
      `https://api.line.me/v2/bot/group/${encodeURIComponent(
        lineGroupId,
      )}/member/${encodeURIComponent(lineUserId)}`,
      { headers: { Authorization: `Bearer ${channelToken}` } },
    );
    return res.data ?? null;
  } catch (err) {
    console.error(
      "⚠️ ดึงโปรไฟล์สมาชิกกลุ่มไม่สำเร็จ:",
      err.response?.data || err.message,
    );
    return null;
  }
}

module.exports = {
  getStaffMention,
  buildMentionMessage,
  upsertGroupMember,
  getGroupMemberProfile,
};
