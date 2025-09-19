const path = require("path");
const fs = require("fs");
const axios = require("axios");
const { io } = require("../app");
const { connectDB, sql } = require("../config/database");

// create upload dir
const uploadDir = path.join(__dirname, "../../uploads/helpdesk");
fs.mkdirSync(uploadDir, { recursive: true });

exports.uploadDir = uploadDir;

/* exports.addfriends = async (req, res) => {
  const { name , company , branch ,oaId , cmpId , province , customerCode , liffId , lineid } = req.query;
  await db.query("UPDATE qr_mapping SET status='scanned' WHERE token=?", [
    token,
  ]);

  const lineAddFriendUrl = "https://line.me/R/ti/p/@YourChannelB_ID";
  res.redirect(lineAddFriendUrl);
}; */

exports.createHelpdeskCase = async (req, res) => {
  try {
    const { userId, displayName, description, oaId, cmpId } = req.body;
    const imagePath = req.file ? `${req.file.filename}` : null;

    if (!userId || !description || !oaId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const pool = await connectDB();

    let request = pool.request();
    request.input("LineOAId", sql.VarChar(150), oaId);
    request.input("UserId", sql.VarChar(150), userId);
    request.input("Descriptions", sql.NVarChar(sql.MAX), description);
    request.input("ImagePath", sql.VarChar(150), imagePath);

    const result = await request.execute("dbo.setServiceFormLiFF");
    const { TaskNo } = result.recordset[0];
    console.log("✅ MSSQL stored procedure executed successfully");

    let finalPath = null;
    const volumeBase = "/usr/src/app/uploads";
    const uploadDirnew = path.join(
      volumeBase,
      `${cmpId}/serviceproblem/${TaskNo}`
    );
    console.log("📂 req.file:", req.file.path);
    if (req.file) {
      // ตำแหน่งเดิม (temp)
      const oldPath = req.file.path;

      // ตำแหน่งใหม่
      finalPath = path.join(uploadDirnew, req.file.filename);

      console.log("📂 Old path:", oldPath);
      console.log("📂 New dir :", uploadDirnew);
      console.log("📂 Final path:", finalPath);

      // move file (rename = ย้าย)

      try {
        await fs.mkdir(uploadDirnew, { recursive: true });
        await rename(oldPath, finalPath);
        console.log("✅ File moved successfully");
      } catch (e) {
        console.error("❌ Error moving file:", e);
      }
    }

    // 🔁 ส่ง Flex Message แจ้งเตือนกลับผู้ใช้
    const flexMsg = {
      type: "flex",
      altText: "รับเคสเรียบร้อยแล้ว",
      contents: {
        type: "bubble",
        body: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "text",
              text: `  📨 รับเคสเรียบร้อยแล้ว # ${TaskNo ?? ""}`,
              weight: "bold",
              size: "md",
            },
            {
              type: "box",
              layout: "vertical",
              margin: "lg",
              spacing: "sm",
              contents: [
                {
                  type: "box",
                  layout: "baseline",
                  spacing: "sm",
                  contents: [
                    {
                      type: "text",
                      text: "สถานะ :",
                      color: "#aaaaaa",
                      size: "sm",
                      flex: 2,
                    },
                    {
                      type: "text",
                      text: "รอดำเนินการ",
                      wrap: true,
                      color: "#666666",
                      size: "sm",
                      flex: 5,
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    };

    const results = await pool.request().input("oaid", sql.VarChar, oaId)
      .query(`
        SELECT top 1 AccessToken as channelToken 
        FROM [dbo].[CompanySocialChannel]
        WHERE ChannelId = @oaid
      `);

    if (results.recordset.length === 0) {
      return res.status(404).json({ message: "Account not found" });
    }

    const { channelToken } = results.recordset[0];

    // 🔐 Token ของ LINE OA (map ตาม oaId ถ้ามีหลายตัว)
    const LINE_OA_CHANNEL_ACCESS_TOKEN = channelToken; // หรือ map จาก oaId

    await axios.post(
      "https://api.line.me/v2/bot/message/push",
      {
        to: userId,
        messages: [flexMsg],
      },
      {
        headers: {
          Authorization: `Bearer ${LINE_OA_CHANNEL_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    io.emit("helpdesk:new", {
      userId,
      displayName,
      description,
      oaId,
      cmpId,
      taskNo: TaskNo,
      imagePath,
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Helpdesk error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

exports.saveContact = async (req, res) => {
  try {
    const {
      userId,
      name,
      company,
      branch,
      province,
      phone,
      position,
      anydeskId = "", // Default เป็นค่าว่าง
      teamviewerId = "", // Default เป็นค่าว่าง
      oaId,
      cmpId,
      customerCode,
      lineid,
    } = req.body;

    // Validation
    if (
      !userId ||
      !name ||
      !company ||
      !branch ||
      !province ||
      !oaId ||
      !customerCode ||
      !cmpId
    ) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const pool = await connectDB();
    const request = pool.request();

    request.input("UserId", sql.VarChar(150), userId);
    request.input("Name", sql.NVarChar(150), name);
    request.input("Company", sql.NVarChar(150), company);
    request.input("Branch", sql.NVarChar(150), branch);
    request.input("Province", sql.NVarChar(150), province);
    request.input("Phone", sql.VarChar(50), phone || "");
    request.input("Position", sql.NVarChar(100), position || "");
    request.input("AnydeskId", sql.VarChar(100), anydeskId || "");
    request.input("TeamviewerId", sql.VarChar(100), teamviewerId || "");
    request.input("LineOAId", sql.VarChar(100), oaId);
    request.input("CmpId", sql.VarChar(30), cmpId || "");
    request.input("CustomerCode", sql.VarChar(30), customerCode || "");

    // MSSQL Stored Procedure
    const result = await request.execute("dbo.setContactFormLiff");

    const lineAddFriendUrl = `https://line.me/R/ti/p/${lineid}`;

    return res.status(200).json({
      success: true,
      result: result.recordset,
      addFriendUrl: lineAddFriendUrl,
    });
  } catch (err) {
    console.error("saveContact error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

// controllers/problemController.js
exports.rateProblem = async (req, res) => {
  const { userId, problemId, score, cmpId } = req.body;

  if (!userId || !problemId || !score || !cmpId) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const pool = await connectDB();
    const request = pool.request();
    request.input("UserId", sql.VarChar(100), userId);
    request.input("ProblemId", sql.VarChar(100), problemId);
    request.input("RatingScore", sql.Int, score);
    request.input("CmpId", sql.VarChar(100), cmpId);

    await request.execute("dbo.setProblemRating");

    return res.json({ success: true });
  } catch (err) {
    console.error("rateProblem error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

exports.sendFlexMsgWaiting = async (req, res) => {
  try {
    const { userId, oaId, taskNo, actionby } = req.body;

    console.log("userId", userId);
    console.log("oaId", oaId);
    if (!userId || !oaId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const pool = await connectDB();

    // 🔁 ส่ง Flex Message แจ้งเตือนกลับผู้ใช้
    const flexMsg = {
      type: "flex",
      altText: `ทีมงานกำลังดำการแก้ไขปัญหา \n#${taskNo ?? ""}`,
      contents: {
        type: "bubble",
        body: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "text",
              text: `ทีมงานกำลังดำการแก้ไขปัญหา \n#${taskNo ?? ""}`,
              weight: "bold",
              size: "md",
            },
            {
              type: "box",
              layout: "vertical",
              margin: "lg",
              spacing: "sm",
              contents: [
                {
                  type: "box",
                  layout: "baseline",
                  spacing: "sm",
                  contents: [
                    {
                      type: "text",
                      text: `ดำเนินการโดย :`,
                      color: "#aaaaaa",
                      size: "sm",
                      flex: 2,
                    },
                    {
                      type: "text",
                      text: `${actionby ?? ""}`,
                      wrap: true,
                      color: "#666666",
                      size: "sm",
                      flex: 5,
                    },
                  ],
                },
                {
                  type: "box",
                  layout: "baseline",
                  spacing: "sm",
                  contents: [
                    {
                      type: "text",
                      text: "สถานะ :",
                      color: "#aaaaaa",
                      size: "sm",
                      flex: 2,
                    },
                    {
                      type: "text",
                      text: "กำลังดำเนินการ",
                      wrap: true,
                      color: "#666666",
                      size: "sm",
                      flex: 5,
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    };

    const results = await pool.request().input("oaid", sql.VarChar, oaId)
      .query(`
        SELECT top 1 AccessToken as channelToken 
        FROM [dbo].[CompanySocialChannel]
        WHERE ChannelId = @oaid
      `);

    if (results.recordset.length === 0) {
      return res.status(404).json({ message: "Account not found" });
    }

    const { channelToken } = results.recordset[0];

    // 🔐 Token ของ LINE OA (map ตาม oaId ถ้ามีหลายตัว)
    const LINE_OA_CHANNEL_ACCESS_TOKEN = channelToken; // หรือ map จาก oaId

    await axios.post(
      "https://api.line.me/v2/bot/message/push",
      {
        to: userId,
        messages: [flexMsg],
      },
      {
        headers: {
          Authorization: `Bearer ${LINE_OA_CHANNEL_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Helpdesk error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

exports.sendCaseClosedMessage = async (req, res) => {
  try {
    const { userId, issue, staffName, closedDate, ratingUrl, oaId, taskNo } =
      req.body;

    console.log("oaId", oaId);
    const flexmessage = {
      type: "flex",
      altText: `🎉 แก้ไขปัญหาเรียบร้อยแล้ว #${taskNo}`,
      contents: {
        type: "bubble",
        body: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "text",
              text: `🎉 แก้ไขปัญหาเรียบร้อยแล้ว #${taskNo}`,
              weight: "bold",
              size: "lg",
              color: "#1DB446",
            },
            {
              type: "text",
              text: `ปัญหา: ${issue}`,
              wrap: true,
            },
            {
              type: "text",
              text: `เจ้าหน้าที่: ${staffName}`,
              wrap: true,
            },
            {
              type: "text",
              text: `วันที่ปิดเคส: ${closedDate}`,
              wrap: true,
              size: "sm",
              color: "#999999",
            },
          ],
        },
        footer: {
          type: "box",
          layout: "horizontal",
          spacing: "md",
          contents: [
            {
              type: "button",
              action: {
                type: "uri",
                label: "ให้คะแนน",
                uri: ratingUrl,
              },
              style: "primary",
              position: "relative",
            },
          ],
        },
      },
    };

    const pool = await connectDB();
    const results = await pool.request().input("oaid", sql.VarChar, oaId)
      .query(`
        SELECT top 1 AccessToken as channelToken 
        FROM [dbo].[CompanySocialChannel]
        WHERE ChannelId = @oaid
      `);

    if (results.recordset.length === 0) {
      return res.status(404).json({ message: "Account not found" });
    }

    const { channelToken } = results.recordset[0];

    await axios.post(
      "https://api.line.me/v2/bot/message/push",
      {
        to: userId,
        messages: [flexmessage],
      },
      {
        headers: {
          Authorization: `Bearer ${channelToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ Case closed message sent to user");
    return res.json({ success: true });
  } catch (err) {
    console.error("❌ Error sending case closed message:", err);
  }
};
