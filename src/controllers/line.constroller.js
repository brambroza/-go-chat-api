const path = require("path");
const fs = require("fs");
const axios = require("axios");
const { io } = require("../app");
const { connectDB, sql } = require("../config/database");
const lineService = require("../services/line.service");

// create upload dir
//const uploadDir = path.join(__dirname, "../../uploads/helpdesk");
const uploadBase = "/usr/src/app/uploads"; // <- path ตรงกับ docker -v
const uploadDir = path.join(uploadBase, "helpdesk");
fs.mkdirSync(uploadDir, { recursive: true });

exports.uploadDir = uploadDir;

function uuidv4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

exports.createHelpdeskCase = async (req, res) => {
  try {
    const { userId, displayName, description, oaId, cmpId, customerCode } =
      req.body;
    if (!req.file) {
      console.log("⚠️ No file uploaded in this request");
    } else {
      console.log("📂 req.file info:", req.file);
    }
    let imagePath = "";

    if (req.files && req.files.length > 0) {
      console.log("📂 req.files info:", req.files);

      // รวมชื่อไฟล์ทั้งหมดเป็น string คั่นด้วย |
      try {
        imagePath = req.files.map((f) => f.filename).join("|");
      } catch (e) {
        console.error("❌ Error processing uploaded files:", e);
      }
    } else {
      console.log("⚠️ No files uploaded in this request");
    }

    if (!userId || !description || !oaId) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    console.log("📂 Final imagePath:", imagePath);

    const pool = await connectDB();

    let request = pool.request();
    request.input("LineOAId", sql.VarChar(150), oaId);
    request.input("UserId", sql.VarChar(150), userId);
    request.input("Descriptions", sql.NVarChar(sql.MAX), description);
    request.input("ImagePath", sql.NVarChar(sql.MAX), imagePath);
    request.input("CustomerCode", sql.VarChar(30), customerCode || "");

    let TaskNoNew = null;
    let userlogin = null;
    try {
      const result = await request.execute("dbo.setServiceFormLiFF");
      const { TaskNo, userAssign } = result.recordset[0];
      TaskNoNew = TaskNo;
      userlogin = userAssign;
      console.log("✅ MSSQL stored procedure executed successfully");
    } catch (e) {
      console.error("❌ MSSQL Error moving file:", e);
    }

    let finalPath = null;
    const volumeBase = "/usr/src/app/uploads";
    const uploadDirnew = path.join(
      volumeBase,
      `${cmpId}/serviceproblem/${TaskNoNew}`
    );

    if (req.files) {
      // ตำแหน่งเดิม (temp)
      /*    const oldPath = req.file.path; */

      // ตำแหน่งใหม่
      /*    finalPath = path.join(uploadDirnew, req.file.filename);

      console.log("📂 Old path:", oldPath);
      console.log("📂 New dir :", uploadDirnew);
      console.log("📂 Final path:", finalPath); */

      // move file (rename = ย้าย)

      try {
        /*   await fs.mkdir(uploadDirnew, { recursive: true }); */

        for (const file of req.files) {
          const oldPath = file.path;
          const finalPath = path.join(uploadDirnew, file.filename);

          await fs.mkdir(uploadDirnew, { recursive: true }, (err) => {
            if (err) {
              console.error("❌ Error creating directory:", err);
              return;
            }

            fs.rename(oldPath, finalPath, (err) => {
              if (err) {
                console.error("❌ Error moving file:", err);
                return;
              }
              console.log("✅ File moved successfully");
            });
          });

          console.log(`✅ File moved successfully: ${file.filename}`);
        }

        /*  await rename(oldPath, finalPath); */
        console.log("✅ File moved successfully");
      } catch (e) {
        console.error("❌ Error moving file:", e);
      }
    }

    // 🔁 ส่ง Flex Message แจ้งเตือนกลับผู้ใช้
    const flexMsg = {
      type: "flex",
      altText: "สวัสดีครับ ได้รับเคสเรียบร้อยแล้วครับ",
      contents: {
        type: "bubble",
        body: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "text",
              text: `สวัสดีครับ ได้รับเคสเรียบร้อยแล้วครับ`,
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
                      text: `📄 Ticket: ${TaskNoNew ?? ""}`,
                      weight: "bold",
                      size: "md",
                      wrap: true,
                      color: "#666666",
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
                      text: `🚩 รายละเอียด: ${description}`,

                      size: "sm",
                      wrap: true,
                      color: "#666666",
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
                      text: "🕒 สถานะ: รอดำเนินการ ทีมงานจะติดต่อกลับภายใน 10 นาที",
                      wrap: true,
                      color: "#666666",
                      size: "sm",
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

    await sendLineToTeamSevice(TaskNoNew, description);

    io.emit("helpdesk:new", {
      userId,
      displayName,
      description,
      oaId,
      cmpId,
      taskNo: TaskNoNew,
      imagePath,
    });

    // const dateTime = new Date().toISOString();
    const now = new Date();
    // แปลงเป็นเวลาไทย (UTC+7)
    const bangkokTime = new Date(now.getTime() + 7 * 60 * 60 * 1000)
      .toISOString()
      .replace("T", " ")
      .substring(0, 19);

    const msgNotification = {
      id: uuidv4(),
      type: "linechat",
      title: `มีเคสใหม่ Ticket: ${TaskNoNew} จาก ${displayName} เรื่อง ${description} `,
      category: `มีเคสใหม่ Ticket: ${TaskNoNew} จาก ${displayName} เรื่อง ${description} `,
      isUnRead: true,
      avatarUrl: userId,
      createdAt: bangkokTime, // new Date().toISOString(),
      isUnAlert: true,
      urllink: "/productservice/servicerequest?id=" + userId,
      sendFrom: userId,
      moduleFormName: "/productservice/servicerequest",
      isUnReadMenu: true,
      docNo: TaskNoNew,
      revNo: 0,
    };

    const room = `notification_230015_${userlogin}`;
    io.to(room).emit("ReceiveNotification", JSON.stringify([msgNotification]));

    let request2 = pool.request();
    request2.input("CmpId", sql.NVarChar(100), "230015");
    request2.input("userTo", sql.NVarChar(100), userlogin);
    request2.input("userFrom", sql.NVarChar(100), "0");
    request2.input("id", sql.VarChar(100), TaskNoNew);
    request2.input(
      "Title",
      sql.VarChar(500),
      `มีเคสใหม่ Ticket: ${TaskNoNew} จาก ${displayName} เรื่อง ${description} `
    );
    request2.input(
      "Category",
      sql.VarChar(500),
      `มีเคสใหม่ Ticket: ${TaskNoNew} จาก ${displayName} เรื่อง ${description} `
    );
    request2.input("type", sql.VarChar(50), "linechat");
    request2.input(
      "linkTo",
      sql.VarChar(500),
      `/productservice/servicerequest`
    );
    request2.input(
      "ModuleFormName",
      sql.VarChar(500),
      "/productservice/servicerequest"
    );
    request2.input("DocNo", sql.VarChar(100), `${TaskNoNew}`);
    request2.input("RevNo", sql.Int, 0);
    request2.input("AvatarUrl", sql.VarChar(100), `${userId}`);

    await request2.execute("dbo.setNotification");

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
      surname,
      nickname,
      email,
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
    request.input("Surname", sql.NVarChar(100), surname || "");
    request.input("Nickname", sql.NVarChar(100), nickname || "");
    request.input("Email", sql.NVarChar(100), email || "");

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
  const { userId, problemId, score, cmpId, description } = req.body;

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
    request.input("Description", sql.NVarChar(500), description);

    await request.execute("dbo.setProblemRating");

    const results = await pool.request().input("CmpId", sql.VarChar, cmpId)
      .query(`
        SELECT top 1 AccessToken as channelToken 
        FROM [dbo].[CompanySocialChannel]
      WHERE CmpId = @CmpId
      `);

    if (results.recordset.length === 0) {
      return res.status(404).json({ message: "Account not found" });
    }

    const { channelToken } = results.recordset[0];

    // 🔐 Token ของ LINE OA (map ตาม oaId ถ้ามีหลายตัว)
    const LINE_OA_CHANNEL_ACCESS_TOKEN = channelToken;

    /* const flexmessage = {
      type: "flex",
      altText: `🙏 ขอบคุณสำหรับคะแนนและความคิดเห็นของท่าน`,
      contents: {
        type: "bubble",
        body: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "text",
              text: `🙏 ขอบคุณสำหรับคะแนนและความคิดเห็นของท่าน`,
              size: "md",
              color: "#e38c29ff",
            },




            {
              type: "box",
              layout: "baseline",
              margin: "md",

              contents: [
                {
                  type: "icon",
                  size: "sm",
                  url:
                    score === 1 ||
                    score === 2 ||
                    score === 3 ||
                    score === 4 ||
                    score === 5
                      ? "https://developers-resource.landpress.line.me/fx/img/review_gold_star_28.png"
                      : "https://developers-resource.landpress.line.me/fx/img/review_gray_star_28.png",
                },
                {
                  type: "icon",
                  size: "sm",
                  url:
                    score === 2 || score === 3 || score === 4 || score === 5
                      ? "https://developers-resource.landpress.line.me/fx/img/review_gold_star_28.png"
                      : "https://developers-resource.landpress.line.me/fx/img/review_gray_star_28.png",
                },
                {
                  type: "icon",
                  size: "sm",
                  url:
                    score === 3 || score === 4 || score === 5
                      ? "https://developers-resource.landpress.line.me/fx/img/review_gold_star_28.png"
                      : "https://developers-resource.landpress.line.me/fx/img/review_gray_star_28.png",
                },
                {
                  type: "icon",
                  size: "sm",
                  url:
                    score === 4 || score === 5
                      ? "https://developers-resource.landpress.line.me/fx/img/review_gold_star_28.png"
                      : "https://developers-resource.landpress.line.me/fx/img/review_gray_star_28.png",
                },
                {
                  type: "icon",
                  size: "sm",
                  url:
                    score === 5
                      ? "https://developers-resource.landpress.line.me/fx/img/review_gold_star_28.png"
                      : "https://developers-resource.landpress.line.me/fx/img/review_gray_star_28.png",
                },
                {
                  type: "text",
                  text: `${score.toString()} ขอบคุณที่ให้คะแนน`,
                  size: "sm",
                  color: "#999999",
                  margin: "md",
                  flex: 0,
                },
              ],
            },
          ],
        },
      },
    }; */

    const flexmessage = {
      type: "flex",
      altText: "🙏 ขอบคุณสำหรับคะแนนและความคิดเห็นของท่าน",
      contents: {
        type: "bubble",
        size: "mega",
        body: {
          type: "box",
          layout: "vertical",
          cornerRadius: "lg",
          paddingAll: "16px",
          contents: [
            {
              type: "text",
              text: "🙏 ขอบคุณสำหรับคะแนนและความคิดเห็นของท่าน",
              weight: "bold",
              size: "xs",
              color: "#e38c29",
              wrap: true,
            },
            {
              type: "text",
              text: "ทีมงาน NIS SUPPORT จะนำคำแนะนำไปปรับปรุงการให้บริการให้ดียิ่งขึ้น",
              wrap: true,
              size: "xs",
              color: "#333333",
              margin: "md",
              align: "center",
            },
            {
              type: "text",
              text: "ขอบคุณที่ไว้วางใจในบริการของเราเสมอมา",
              wrap: true,
              size: "xs",
              color: "#333333",
              margin: "md",
              align: "center",
            },
            {
              type: "box",
              layout: "baseline",
              margin: "md",
              contents: [
                {
                  type: "icon",
                  url: "https://developers-resource.landpress.line.me/fx/img/review_gold_star_28.png",
                  size: "sm",
                },
                {
                  type: "icon",
                  url: "https://developers-resource.landpress.line.me/fx/img/review_gold_star_28.png",
                  size: "sm",
                },
                {
                  type: "icon",
                  url: "https://developers-resource.landpress.line.me/fx/img/review_gold_star_28.png",
                  size: "sm",
                },
                {
                  type: "icon",
                  url: "https://developers-resource.landpress.line.me/fx/img/review_gold_star_28.png",
                  size: "sm",
                },
                {
                  type: "icon",
                  url: "https://developers-resource.landpress.line.me/fx/img/review_gold_star_28.png",
                  size: "sm",
                },
              ],
              justifyContent: "center",
            },
          ],
        },
      },
    };

    await axios.post(
      "https://api.line.me/v2/bot/message/push",
      {
        to: userId,
        messages: [flexmessage],
      },
      {
        headers: {
          Authorization: `Bearer ${LINE_OA_CHANNEL_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("rateProblem error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

exports.sendFlexMsgWaiting = async (req, res) => {
  try {
    const { userId, oaId, taskNo, actionby, description, startDate } = req.body;

    if (!userId || !oaId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const pool = await connectDB();

    // 🔁 ส่ง Flex Message แจ้งเตือนกลับผู้ใช้
    const flexMsg = {
      type: "flex",
      altText: `Ticket: ${taskNo ?? ""} - กำลังดำเนินการ`,
      contents: {
        type: "bubble",
        body: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "text",
              text: `📄 Ticket: \n#${taskNo ?? ""}`,
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
                      text: `🚩 รายละเอียด: ${description}`,
                      color: "#aaaaaa",
                      size: "sm",
                      wrap: true,
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
                      text: "🕒 สถานะ : กำลังดำเนินการ",
                      color: "#aaaaaa",
                      size: "xs",
                      wrap: true,
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
                      text: `👨🏻‍💻 ผู้ดูแลเคส: ${actionby ?? ""}`,
                      color: "#aaaaaa",
                      size: "xs",
                      wrap: true,
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
                      text: `⏱️ เวลาเริ่มดำเนินการ: ${startDate}`,
                      wrap: true,
                      size: "xs",
                      color: "#999999",
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

    await sendLineToTeamSeviceWaiting(taskNo, description, actionby);

    // อาจจะบันทึกลง DB ก่อน
    /* 
   const  messageToSave = JSON.stringify(flexMsg);
    // Build the SQL command string
    let cmd =
      "EXEC dbo.setLineChatMessage" +
      " @CmpId='230015'" +
      ",@TimeStamp=0" +
      ",@id='" +
      uuidv4() +
      "'" +
      ",@userId='" +
      userId +
      "'" +
      ",@type='flex'" +
      ",@replyToken=''" +
      ",@quotaToken=''" +
      ",@text='" +
      messageToSave +
      "'" +
      ",@stickerId=''" +
      ",@stickerResourceType=''" +
      ",@sendbyId='" +
      sendbyId +
      "'";

    // Execute the query
    await pool.request().query(cmd); */

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Helpdesk error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

exports.sendCaseClosedMessage = async (req, res) => {
  try {
    const {
      userId,
      issue,
      staffName,
      closedDate,
      ratingUrl,
      oaId,
      taskNo,
      actiondetail,
      startDate,
      receiveDate,
    } = req.body;

    const flexmessage = {
      type: "flex",
      altText: `🎉 Ticket: ${taskNo} ดำเนินการเรียบร้อย`,
      contents: {
        type: "bubble",
        body: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "text",
              text: `📄 Ticket: ${taskNo}`,
              weight: "bold",
              size: "lg",
              color: "#e38c29ff",
            },
            /* {
              type: "text",
              text: `🚩 รายละเอียด: ${issue}`,
              wrap: true,
              size: "sm",
              color: "#666666",
            },
            {
              type: "text",
              text: `🕒 สถานะ: ดำเนินการเรียบร้อย`,
              wrap: true,
              size: "sm",
              color: "#666666",
            },
            {
              type: "text",
              text: `📄 รายงาน: ${actiondetail}`,
              wrap: true,
              size: "sm",
              color: "#666666",
            },

            {
              type: "text",
              text: `ผู้ดูแลเคส: ${staffName}`,
              wrap: true,
              size: "sm",
              color: "#666666",
            }, */

            {
              type: "box",
              layout: "vertical",
              margin: "md",
              spacing: "sm",
              contents: [
                {
                  type: "text",
                  text: `🚩 รายละเอียด: ${issue}`,
                  wrap: true,
                  size: "sm",
                  color: "#666666",
                },
                {
                  type: "text",
                  text: `🕒 สถานะ: ดำเนินการเรียบร้อย`,
                  wrap: true,
                  size: "sm",
                  color: "#666666",
                },
                {
                  type: "text",
                  text: `📄 รายงาน: ${actiondetail}`,
                  wrap: true,
                  size: "sm",
                  color: "#666666",
                },

                {
                  type: "text",
                  text: `👤 ผู้ดูแลเคส: ${staffName}`,
                  wrap: true,
                  size: "sm",
                  color: "#666666",
                },
              ],
            },

            /*  {
              type: "text",
              text: `⏳ ระยะเวลา:`,
              wrap: true,
              size: "sm",
              color: "#e38c29ff",
            },

            {
              type: "text",
              text: `เวลาแจ้ง: ${receiveDate}`,
              wrap: true,
              size: "xs",
              color: "#999999",
            },
            {
              type: "text",
              text: `เวลาดำเนินการ: ${startDate}`,
              wrap: true,
              size: "xs",
              color: "#999999",
            },
            {
              type: "text",
              text: `เวลาปิดงาน: ${closedDate}`,
              wrap: true,
              size: "xs",
              color: "#999999",
            }, */

            {
              type: "box",
              layout: "vertical",
              margin: "md",
              contents: [
                {
                  type: "text",
                  text: "⏱️ ระยะเวลา:",
                  weight: "bold",
                  size: "sm",
                  color: "#000000",
                },
                {
                  type: "text",
                  text: `เวลาแจ้ง: ${receiveDate}`,
                  wrap: true,
                  size: "xs",
                  color: "#999999",
                },
                {
                  type: "text",
                  text: `เวลาดำเนินการ: ${startDate}`,
                  wrap: true,
                  size: "xs",
                  color: "#999999",
                },
                {
                  type: "text",
                  text: `เวลาปิดงาน: ${closedDate}`,
                  wrap: true,
                  size: "xs",
                  color: "#999999",
                },
              ],
            },

            {
              type: "separator",
              margin: "lg",
            },
            {
              type: "text",
              text: "🙏ขอบคุณที่ใช้บริการจากทีม NIS SUPPORT",
              weight: "bold",
              size: "sm",
              color: "#e38c29",
              margin: "md",
              wrap: true,
            },

            {
              type: "text",
              text: "💡 ปัญหาของท่านได้รับการดำเนินการเรียบร้อยแล้ว หากท่านมีข้อเสนอแนะเพิ่มเติม หรือพบปัญหาอื่น ๆ สามารแจ้งได้ตลอดเวลา",
              wrap: true,
              size: "xs",
              color: "#333333",
              margin: "sm",
            },
            {
              type: "text",
              text: "⭐️ ช่วยประเมินความพึงพอใจของท่าน เพื่อให้เราปรับปรุงบริการให้ดียิ่งขึ้น",
              wrap: true,
              size: "xs",
              color: "#333333",
              margin: "sm",
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
                label: "ยืนยันการปิดเคส",
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

    await sendLineToTeamSeviceFinish(
      taskNo,
      issue,
      actiondetail,
      staffName,
      actiondetail,
      startDate,
      receiveDate,
      closedDate
    );

    console.log("✅ Case closed message sent to user");
    return res.json({ success: true });
  } catch (err) {
    console.error("❌ Error sending case closed message:", err);
  }
};

function getTimePeriod() {
  const now = new Date();
  const hour = now.getHours(); // current hour (0-23)

  if (hour >= 5 && hour < 12) return "ตอนเช้า";
  if (hour >= 12 && hour < 13) return "ตอนเที่ยง";
  if (hour >= 13 && hour < 17) return "ตอนบ่าย";
  if (hour >= 17 && hour < 21) return "ตอนเย็น";
  return "กลางคืน";
}

async function sendLineToTeamSevice(TaskNoNew, description) {
  try {
    let LINE_OA_CHANNEL_ACCESS_TOKEN = "";
    let actionby = "";
    let userId = "";

    let hellotext = getTimePeriod();

    const pool = await connectDB();

    let request = pool.request();
    request.input("TaskNo", sql.VarChar(150), TaskNoNew);

    try {
      const result = await request.execute("dbo.getServiceTeam");
      if (result.recordset.length === 0) {
        return res.status(404).json({ message: "Account not found" });
      }
      const { assignname, channelToken, userIds } = result.recordset[0];
      actionby = assignname;
      LINE_OA_CHANNEL_ACCESS_TOKEN = channelToken;
      userId = userIds;
      console.log("✅ MSSQL stored procedure executed successfully");
    } catch (e) {
      console.error("❌ MSSQL Error moving file:", e);
    }

    const flexMsg = {
      type: "flex",
      altText: `สวัสดี มีเคสใหม่เข้ามาครับ`,
      contents: {
        type: "bubble",
        body: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "text",
              text: `สวัสดี  มีเคสใหม่เข้ามาครับ`,
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
                      text: `📄 Ticket: ${TaskNoNew ?? ""}`,
                      weight: "bold",
                      size: "md",
                      wrap: true,
                      color: "#666666",
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
                      text: `🚩 รายละเอียด: ${description}`,

                      size: "sm",
                      wrap: true,
                      color: "#666666",
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
                      text: "🕒 สถานะ: รอดำเนินการ กรุณาติดต่อกลับภายใน 10 นาที",
                      wrap: true,
                      color: "#666666",
                      size: "sm",
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
                      text: `👨🏻‍💻 ผู้ดูแลเคส: ${actionby ?? ""}`,
                      wrap: true,
                      color: "#666666",
                      size: "sm",
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    };

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

    return true;
  } catch (error) {
    console.error(
      "Error in sendLineToTeamSevice:",
      error.response?.data || error.message
    );
    return false;
  }
}

async function sendLineToTeamSeviceWaiting(TaskNoNew, description, actionby) {
  try {
    let LINE_OA_CHANNEL_ACCESS_TOKEN = null;

    let userId = null;

    const pool = await connectDB();

    let request = pool.request();
    request.input("TaskNo", sql.VarChar(150), TaskNoNew);

    try {
      const result = await request.execute("dbo.getServiceTeam");
      if (result.recordset.length === 0) {
        return res.status(404).json({ message: "Account not found" });
      }
      const { channelToken, userIds } = result.recordset[0];

      LINE_OA_CHANNEL_ACCESS_TOKEN = channelToken;
      userId = userIds;
      console.log("✅ MSSQL stored procedure executed successfully");
    } catch (e) {
      console.error("❌ MSSQL Error moving file:", e);
    }

    const flexMsg = {
      type: "flex",
      altText: `Ticket: ${TaskNoNew ?? ""} - กำลังดำเนินการ`,
      contents: {
        type: "bubble",
        body: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "text",
              text: `📄 Ticket: \n#${TaskNoNew ?? ""}`,
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
                      text: `🚩 รายละเอียด: ${description}`,
                      color: "#aaaaaa",
                      size: "sm",
                      wrap: true,
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
                      text: "🕒 สถานะ : กำลังดำเนินการ",
                      color: "#aaaaaa",
                      size: "sm",
                      wrap: true,
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
                      text: `👨🏻‍💻 ดำเนินการโดย: ${actionby ?? ""}`,
                      color: "#aaaaaa",
                      size: "sm",
                      wrap: true,
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    };

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

    return true;
  } catch (error) {
    console.error(
      "Error in sendLineToTeamSevice:",
      error.response?.data || error.message
    );
    return false;
  }
}

async function sendLineToTeamSeviceFinish(
  TaskNoNew,
  issue,
  actiondetail,
  staffName,
  actiondetail,
  startDate,
  receiveDate,
  closedDate
) {
  try {
    let LINE_OA_CHANNEL_ACCESS_TOKEN = "";

    let userId = "";

    const pool = await connectDB();

    let request = pool.request();
    request.input("TaskNo", sql.VarChar(150), TaskNoNew);

    try {
      const result = await request.execute("dbo.getServiceTeam");
      if (result.recordset.length === 0) {
        return res.status(404).json({ message: "Account not found" });
      }
      const { channelToken, userIds } = result.recordset[0];

      LINE_OA_CHANNEL_ACCESS_TOKEN = channelToken;
      userId = userIds;
      console.log("✅ MSSQL stored procedure executed successfully");
    } catch (e) {
      console.error("❌ MSSQL Error moving file:", e);
    }

    const flexmessage = {
      type: "flex",
      altText: `🎉 Ticket: ${TaskNoNew} ดำเนินการเรียบร้อย`,
      contents: {
        type: "bubble",
        body: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "text",
              text: `📄 Ticket: ${TaskNoNew}`,
              weight: "bold",
              size: "lg",
              color: "#e38c29ff",
            },
            {
              type: "text",
              text: `🚩 รายละเอียด: ${issue}`,
              wrap: true,
              size: "sm",
              color: "#666666",
            },
            {
              type: "text",
              text: `🕒 สถานะ: ดำเนินการเรียบร้อย`,
              wrap: true,
              size: "sm",
              color: "#666666",
            },
            {
              type: "text",
              text: `📄 รายงาน: ${actiondetail}`,
              wrap: true,
              size: "sm",
              color: "#666666",
            },

            {
              type: "text",
              text: `ผู้ดูแลเคส: ${staffName}`,
              wrap: true,
              size: "sm",
              color: "#666666",
            },
            {
              type: "text",
              text: `⏳ ระยะเวลา:`,
              wrap: true,
              size: "sm",
              color: "#e38c29ff",
            },

            {
              type: "text",
              text: `เวลาแจ้ง: ${receiveDate}`,
              wrap: true,
              size: "sm",
              color: "#999999",
            },
            {
              type: "text",
              text: `เวลาดำเนินการ: ${startDate}`,
              wrap: true,
              size: "sm",
              color: "#999999",
            },
            {
              type: "text",
              text: `เวลาปิดงาน: ${closedDate}`,
              wrap: true,
              size: "sm",
              color: "#999999",
            },
          ],
        },
      },
    };

    await axios.post(
      "https://api.line.me/v2/bot/message/push",
      {
        to: userId,
        messages: [flexmessage],
      },
      {
        headers: {
          Authorization: `Bearer ${LINE_OA_CHANNEL_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    return true;
  } catch (error) {
    console.error(
      "Error in sendLineToTeamSevice:",
      error.response?.data || error.message
    );
    return false;
  }
}

exports.sendFromproblem = async (req, res) => {
  const { userId, channelToken, cmpId, urlName } = req.body;

  if (!userId || !problemId || !score || !cmpId) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    await lineService.senLinkdMessageProblem(
      channelToken,
      userId,
      "แจ้งปัญหา",
      urlName
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("rateProblem error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
