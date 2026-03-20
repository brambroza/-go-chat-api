const path = require("path");
const fs = require("fs");
const axios = require("axios");
/* const { io } = require("../app"); */
const { connectDB, sql } = require("../config/database");
const lineService = require("../services/line.service");

const { getIO } = require("../utils/socket");

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
      `${cmpId}/serviceproblem/${TaskNoNew}`,
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
      },
    );

    await sendLineToTeamSevice(TaskNoNew, description);
    const io = getIO();
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
      urllink: "/productservice/servicerequest/" + TaskNoNew,
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
      `มีเคสใหม่ Ticket: ${TaskNoNew} จาก ${displayName} เรื่อง ${description} `,
    );
    request2.input(
      "Category",
      sql.VarChar(500),
      `มีเคสใหม่ Ticket: ${TaskNoNew} จาก ${displayName} เรื่อง ${description} `,
    );
    request2.input("type", sql.VarChar(50), "linechat");
    request2.input(
      "linkTo",
      sql.VarChar(500),
      `/productservice/servicerequest/${TaskNoNew}`,
    );
    request2.input(
      "ModuleFormName",
      sql.VarChar(500),
      "/productservice/servicerequest",
    );
    request2.input("DocNo", sql.VarChar(100), `${TaskNoNew}`);
    request2.input("RevNo", sql.Int, 0);
    request2.input("AvatarUrl", sql.VarChar(100), `${userId}`);

    await request2.execute("dbo.setNotificationLineChat");

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Helpdesk error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

exports.sendmsgtouser = async (req, res) => {
  try {
    const { userLineId, oaLineId, problemId, description } = req.body;

    if (!userLineId || !oaLineId || !problemId || !description) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const pool = await connectDB();

    const results = await pool.request().input("oaid", sql.VarChar, oaLineId)
      .query(`
        SELECT top 1 AccessToken as channelToken 
        FROM [dbo].[CompanySocialChannel]
        WHERE ChannelId = @oaid
      `);

    if (results.recordset.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const { channelToken } = results.recordset[0];

    // 🔐 Token ของ LINE OA (map ตาม userId ถ้ามีหลายตัว)
    const LINE_OA_CHANNEL_ACCESS_TOKEN = channelToken; // หรือ map จาก userId

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
                      text: `📄 Ticket: ${problemId ?? ""}`,
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

    await axios.post(
      "https://api.line.me/v2/bot/message/push",
      {
        to: userLineId,
        messages: [flexMsg],
      },
      {
        headers: {
          Authorization: `Bearer ${LINE_OA_CHANNEL_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      },
    );

    await sendLineToTeamSevice(problemId, description);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Send message error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

exports.uploadfiles = async (req, res) => {
  try {
    const { cmpId, problemId } = req.body;

    // 🧩 ตรวจสอบค่าเบื้องต้น
    if (!cmpId || !problemId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    console.log(
      "📂 Files received:",
      req.files.map((f) => f.filename),
    );

    // 🔹 ตำแหน่งปลายทาง
    const volumeBase = "/usr/src/app/uploads";
    const uploadDirnew = path.join(
      volumeBase,
      `${cmpId}/serviceproblem/${problemId}`,
    );

    const pool = await connectDB();

    for (const file of req.files) {
      const oldPath = file.path;
      const newPath = path.join(uploadDirnew, file.filename);

      try {
        await fs.mkdir(uploadDirnew, { recursive: true }, (err) => {
          if (err) {
            console.error("❌ Error creating directory:", err);
            return;
          }

          fs.rename(oldPath, newPath, (err) => {
            if (err) {
              console.error("❌ Error moving file:", err);
              return;
            }
            console.log("✅ File moved successfully");
          });
        });

        const request = pool.request();
        request.input("cmpId", sql.VarChar(150), cmpId);
        request.input("problemId", sql.VarChar(150), problemId);
        request.input("fileName", sql.VarChar(255), file.filename);

        await request.execute("dbo.setSTProblemFiles");
        console.log("📦 Stored procedure executed");
      } catch (err) {
        console.error(`❌ Error processing file ${file.filename}:`, err);
      }
    }

    return res.status(200).json({
      success: true,
      message: "Files uploaded and saved successfully",
    });
  } catch (err) {
    console.error("Helpdesk upload error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

exports.uploadfilechat = async (req, res) => {
  try {
    const { cmpId, problemId } = req.body;

    // 🧩 ตรวจสอบค่าเบื้องต้น
    if (!cmpId || !problemId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    console.log(
      "📂 Files received:",
      req.files.map((f) => f.filename),
    );

    // 🔹 ตำแหน่งปลายทาง
    const volumeBase = "/usr/src/app/uploads";
    const uploadDirnew = path.join(
      volumeBase,
      `${cmpId}/serviceproblem/${problemId}`,
    );

    const pool = await connectDB();

    for (const file of req.files) {
      const oldPath = file.path;
      const newPath = path.join(uploadDirnew, file.filename);

      try {
        await fs.mkdir(uploadDirnew, { recursive: true }, (err) => {
          if (err) {
            console.error("❌ Error creating directory:", err);
            return;
          }

          fs.rename(oldPath, newPath, (err) => {
            if (err) {
              console.error("❌ Error moving file:", err);
              return;
            }
            console.log("✅ File moved successfully");
          });
        });

        const request = pool.request();
        request.input("cmpId", sql.VarChar(150), cmpId);
        request.input("problemId", sql.VarChar(150), problemId);
        request.input("fileName", sql.VarChar(255), file.filename);

        await request.execute("dbo.setSTProblemFiles");
        console.log("📦 Stored procedure executed");
      } catch (err) {
        console.error(`❌ Error processing file ${file.filename}:`, err);
      }
    }

    return res.status(200).json({
      success: true,
      message: "Files uploaded and saved successfully",
    });
  } catch (err) {
    console.error("Helpdesk upload error:", err);
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

    res.status(200).json({
      success: true,
      result: result.recordset,
      addFriendUrl: lineAddFriendUrl,
    });

    setImmediate(async () => {
      try {
        const lineProfile = await lineService.getLineProfileWithRetry(
          userId,
          "UaEPObBVTjBAWADApMvjBgkbudV4eChGvvR/KhX8x6BYxFbl+vljU5NrlLa8/jZBfMgI7fpUWcEOi25xsLTQv+u/8jjwYux17erqtb9zq6Qja5yCjjm+scFPq8DXjti+pMRSsuzzql91Ayx/eCyFqAdB04t89/1O/w1cDnyilFU=",
          2,
        );
        const bgPool = await connectDB();
        await bgPool
          .request()
          .input("CmpId", cmpId)
          .input("LineOAId", oaId)
          .input("UserId", userId)
          .input("DisplayName", lineProfile?.displayName ?? null)
          .input("PictureUrl", lineProfile?.pictureUrl ?? null)
          .input("Language", lineProfile?.language ?? null)
          .input(
            "ProfileJson",
            lineProfile ? JSON.stringify(lineProfile) : null,
          )
          .input("LastError", null).query(`
          EXEC dbo.UpsertLineProfileCache
            @CmpId=@CmpId,
            @LineOAId=@LineOAId,
            @UserId=@UserId,
            @DisplayName=@DisplayName,
            @PictureUrl=@PictureUrl,
            @Language=@Language,
            @ProfileJson=@ProfileJson,
            @LastError=@LastError
        `);
      } catch (err) {
        // Decide how you want to handle errors from the LINE API
        console.error("Failed to get profile for user:", userId, err.message);
        // You could push partial data or skip this user
        // For example, push partial data:

        // set delay 2 sec
      }
    });

    return res.status(200).json({ success: true });
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

    const io = getIO();
    io.emit("helpdesk:update", {
      problemId,
    });

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
      },
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

    let reporterName = "";
    let reporterCompany = "";
    const pool = await connectDB();

    let request = pool.request();
    request.input("TaskNo", sql.VarChar(150), taskNo);

    const result = await request.execute("dbo.getServiceTeamClose");
    if (result.recordset.length === 0) {
      return res.status(404).json({ message: "Account not found" });
    }

    const { requestby, customername } = result.recordset[0];

    reporterName = requestby;
    reporterCompany = customername;

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

            // ===== ผู้แจ้ง + บริษัท (2 บรรทัด) =====
            {
              type: "box",
              layout: "vertical",
              margin: "sm",
              spacing: "xs",
              contents: [
                {
                  type: "box",
                  layout: "baseline",
                  spacing: "sm",
                  contents: [
                    { type: "text", text: "👤", size: "sm", flex: 0 },
                    {
                      type: "text",
                      text: "ผู้แจ้ง:",
                      weight: "bold",
                      size: "xs",
                      flex: 0,
                    },
                    {
                      type: "text",
                      text: `${reporterName ?? ""}`,
                      size: "xs",
                      color: "#999999",
                      wrap: true,
                    },
                  ],
                },

                ...(reporterCompany
                  ? [
                      {
                        type: "box",
                        layout: "vertical",
                        paddingStart: "10px",
                        contents: [
                          {
                            type: "text",
                            text: `${reporterCompany}`,
                            size: "xs",
                            color: "#999999",
                            wrap: true,
                            margin: "xs",
                          },
                        ],
                      },
                    ]
                  : []),
              ],
            },

            // ====== รายละเอียด ======
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
      },
    );

    await sendLineToTeamSeviceWaiting(taskNo, description, actionby, startDate);

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
              size: "xs",
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
            {
              type: "text",
              text: "👉 หากท่านไม่กดยืนยันการปิดเคส ระบบจะทำการปิดเคสให้อัตโนมัติในวันถัดไป โดยถือว่าปัญหาของท่านได้รับการแก้ไขเรียบร้อยแล้ว",
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
      },
    );

    await sendLineToTeamSeviceFinish(taskNo, issue);

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
    let reportBy = "";
    let reportCompany = "";
    let notifyAt = "";

    const pool = await connectDB();

    let request = pool.request();
    request.input("TaskNo", sql.VarChar(150), TaskNoNew);

    try {
      const result = await request.execute("dbo.getServiceTeam");
      if (result.recordset.length === 0) {
        return res.status(404).json({ message: "Account not found" });
      }
      const {
        assignname,
        channelToken,
        userIds,
        requestby,
        customername,
        requestdate,
      } = result.recordset[0];
      actionby = assignname;
      LINE_OA_CHANNEL_ACCESS_TOKEN = channelToken;
      userId = userIds;
      reportBy = requestby;
      reportCompany = customername;
      notifyAt = requestdate;
      console.log("✅ MSSQL stored procedure executed successfully");
    } catch (e) {
      console.error("❌ MSSQL Error moving file:", e);
    }

    const flexMsg = {
      type: "flex",
      altText: `มีเคสใหม่เข้ามา !!!! Ticket: ${TaskNoNew ?? ""}`,
      contents: {
        type: "bubble",
        size: "kilo",
        body: {
          type: "box",
          layout: "vertical",
          paddingAll: "md",
          contents: [
            {
              // ✅ เอากรอบออกแล้ว
              type: "box",
              layout: "vertical",
              paddingAll: "lg",
              backgroundColor: "#FFFFFF",
              cornerRadius: "16px", // ถ้าอยากเหลี่ยม ๆ ให้เปลี่ยนเป็น "0px"

              spacing: "md",
              contents: [
                // ===== Header =====
                {
                  type: "box",
                  layout: "baseline",
                  spacing: "sm",
                  contents: [
                    { type: "text", text: "🔔", size: "sm", flex: 0 },
                    {
                      type: "text",
                      text: "มีเคสใหม่เข้ามา !!!!",
                      weight: "bold",
                      size: "sm",
                      color: "#E53935",
                      wrap: true,
                    },
                  ],
                },

                // ===== Ticket =====
                {
                  type: "box",
                  layout: "baseline",
                  spacing: "sm",
                  contents: [
                    { type: "text", text: "🧾", size: "sm", flex: 0 },
                    {
                      type: "text",
                      text: "Ticket:",
                      weight: "bold",
                      size: "sm",
                      flex: 0,
                    },
                    {
                      type: "text",
                      text: `${TaskNoNew ?? ""}`,
                      size: "sm",
                      color: "#999999",
                      wrap: true,
                    },
                  ],
                },

                {
                  type: "box",
                  layout: "vertical",
                  spacing: "xs",
                  contents: [
                    {
                      type: "box",
                      layout: "baseline",
                      spacing: "sm",
                      contents: [
                        { type: "text", text: "👤", size: "sm", flex: 0 },

                        {
                          type: "text",
                          text: `${reportCompany ?? ""}`,
                          size: "xs",
                          color: "#E53935",
                          wrap: true,
                          weight: "bold",
                        },
                      ],
                    },
                    ...(reportBy
                      ? [
                          {
                            type: "box",
                            layout: "horizontal",
                            paddingStart: "30px",
                            contents: [
                              {
                                type: "text",
                                text: "ผู้แจ้ง:",
                                size: "xs",
                                flex: 0,
                                weight: "bold",
                              },
                              {
                                type: "text",
                                text: `${reportBy ?? ""}`,
                                size: "xs",
                                color: "#999999",
                                wrap: true,
                              },
                            ],
                          },
                        ]
                      : []),
                  ],
                },

                /* 
                {
                  type: "box",
                  layout: "vertical",
                  spacing: "xs",
                  contents: [
                    {
                      type: "box",
                      layout: "baseline",
                      spacing: "sm",
                      contents: [
                        { type: "text", text: "👤", size: "sm", flex: 0 },
                        {
                          type: "text",
                          text: "ผู้แจ้ง:",
                          weight: "bold",
                          size: "xs",
                          flex: 0,
                        },
                        {
                          type: "text",
                          text: `${reportBy ?? ""}`,
                          size: "xs",
                          color: "#999999",
                          wrap: true,
                        },
                      ],
                    },
                    ...(reportCompany
                      ? [
                          {
                            type: "box",
                            layout: "vertical",
                            paddingStart: "38px",
                            contents: [
                              {
                                type: "text",
                                text: `${reportCompany}`,
                                size: "xs",
                                color: "#999999",
                                wrap: true,
                                margin: "none",
                              },
                            ],
                          },
                        ]
                      : []),
                  ],
                }, */

                // ===== รายละเอียด =====
                {
                  type: "box",
                  layout: "baseline",
                  spacing: "sm",
                  paddingStart: "30px",
                  contents: [
                    {
                      type: "text",
                      text: "รายละเอียด:",
                      weight: "bold",
                      size: "xs",
                      flex: 0,
                    },
                    {
                      type: "text",
                      text: `${description ?? ""}`,
                      size: "xs",
                      color: "#333333",
                      wrap: true,
                    },
                  ],
                },

                // ===== ผู้ดูแลเคส =====
                {
                  type: "box",
                  layout: "baseline",
                  spacing: "sm",
                  contents: [
                    { type: "text", text: "👤", size: "sm", flex: 0 },
                    {
                      type: "text",
                      text: "ผู้ดูแลเคส:",
                      weight: "bold",
                      size: "xs",
                      flex: 0,
                    },
                    {
                      type: "text",
                      text: `${actionby ?? ""}`,
                      size: "xs",
                      color: "#999999",
                      wrap: true,
                    },
                  ],
                },

                // ===== เวลาแจ้ง =====
                {
                  type: "box",
                  layout: "baseline",
                  spacing: "sm",
                  contents: [
                    { type: "text", text: "⏳", size: "sm", flex: 0 },
                    {
                      type: "text",
                      text: "เวลาแจ้ง:",
                      weight: "bold",
                      size: "xs",
                      flex: 0,
                    },
                    {
                      type: "text",
                      text: `${notifyAt ?? ""}`,
                      size: "xs",
                      color: "#999999",
                      wrap: true,
                    },
                  ],
                },

                // ===== ข้อความเตือนสีแดง =====
                {
                  type: "text",
                  text: "“กรุณาติดต่อกลับภายใน 5 นาที”",
                  align: "center",
                  weight: "bold",
                  size: "sm",
                  color: "#E53935",
                  wrap: true,
                  margin: "sm",
                },

                // ===== ปุ่มแดงใหญ่ =====
                {
                  type: "box",
                  layout: "vertical",
                  backgroundColor: "#E53935",
                  cornerRadius: "10px",
                  paddingAll: "md",
                  action: {
                    type: "uri",
                    label: "เปิดเคส",
                    uri: `https://erp.nisolution.co.th/productservice/servicerequest/${
                      TaskNoNew ?? ""
                    }`,
                  },
                  contents: [
                    {
                      type: "text",
                      text: "กรุณาติดต่อกลับลูกค้าโดยเร็ว",
                      align: "center",
                      weight: "bold",
                      size: "md",
                      color: "#FFFFFF",
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
      },
    );

    return true;
  } catch (error) {
    console.error(
      "Error in sendLineToTeamSevice1:",
      error.response?.data || error.message,
    );
    return false;
  }
}

async function sendLineToTeamSeviceReply(TaskNoNew, description) {
  try {
    let LINE_OA_CHANNEL_ACCESS_TOKEN = "";
    let actionby = "";
    let userId = "";
    let reportBy = "";
    let reportCompany = "";
    let notifyAt = "";

    const pool = await connectDB();

    let request = pool.request();
    request.input("TaskNo", sql.VarChar(150), TaskNoNew);

    try {
      const result = await request.execute("dbo.getServiceTeam");
      if (result.recordset.length === 0) {
        return res.status(404).json({ message: "Account not found" });
      }
      const {
        assignname,
        channelToken,
        userIds,
        requestby,
        customername,
        requestdate,
      } = result.recordset[0];
      actionby = assignname;
      LINE_OA_CHANNEL_ACCESS_TOKEN = channelToken;
      userId = userIds;
      reportBy = requestby;
      reportCompany = customername;
      notifyAt = requestdate;
      console.log("✅ MSSQL stored procedure executed successfully");
    } catch (e) {
      console.error("❌ MSSQL Error moving file:", e);
    }

    const flexMsg = {
      type: "flex",
      altText: `ลูกค้ารออยู่ !!!! Ticket: ${TaskNoNew ?? ""}`,
      contents: {
        type: "bubble",
        size: "kilo",
        body: {
          type: "box",
          layout: "vertical",
          paddingAll: "md",
          contents: [
            {
              // การ์ด (เอา border ออกแล้ว)
              type: "box",
              layout: "vertical",
              paddingAll: "lg",
              backgroundColor: "#FFFFFF",
              cornerRadius: "16px",

              // ✅ ใช้ spacing แทน spacer
              spacing: "md",

              contents: [
                // ===== Header =====
                {
                  type: "box",
                  layout: "baseline",
                  spacing: "sm",
                  contents: [
                    { type: "text", text: "😢", size: "sm", flex: 0 },
                    {
                      type: "text",
                      text: "ลูกค้ารออยู่ !!!!",
                      weight: "bold",
                      size: "sm",
                      color: "#f4882fff",
                      wrap: true,
                    },
                  ],
                },

                // ===== Ticket =====
                {
                  type: "box",
                  layout: "baseline",
                  spacing: "sm",
                  contents: [
                    { type: "text", text: "🧾", size: "sm", flex: 0 },
                    {
                      type: "text",
                      text: "Ticket:",
                      weight: "bold",
                      size: "sm",
                      flex: 0,
                    },
                    {
                      type: "text",
                      text: `${TaskNoNew ?? ""}`,
                      size: "sm",
                      color: "#999999",
                      wrap: true,
                    },
                  ],
                },

                // ===== ผู้แจ้ง + บริษัท =====

                {
                  type: "box",
                  layout: "vertical",
                  spacing: "xs",
                  contents: [
                    {
                      type: "box",
                      layout: "baseline",
                      spacing: "sm",
                      contents: [
                        { type: "text", text: "👤", size: "sm", flex: 0 },

                        {
                          type: "text",
                          text: `${reportCompany}`,
                          size: "xs",
                          color: "#f4882fff",
                          wrap: true,
                          weight: "bold",
                        },
                      ],
                    },
                    ...(reportBy
                      ? [
                          {
                            type: "box",
                            layout: "horizontal",
                            paddingStart: "30px",
                            contents: [
                              {
                                type: "text",
                                text: "ผู้แจ้ง:",
                                weight: "bold",
                                size: "xs",
                                flex: 0,
                              },
                              {
                                type: "text",
                                text: `${reportBy}`,
                                size: "xs",
                                color: "#999999",
                                wrap: true,
                                margin: "xs",
                              },
                            ],
                          },
                        ]
                      : []),
                  ],
                },

                /*  {
                  type: "box",
                  layout: "vertical",
                  spacing: "xs",
                  contents: [
                    {
                      type: "box",
                      layout: "baseline",
                      spacing: "sm",
                      contents: [
                        { type: "text", text: "👤", size: "sm", flex: 0 },
                        {
                          type: "text",
                          text: "ผู้แจ้ง:",
                          weight: "bold",
                          size: "xs",
                          flex: 0,
                        },
                        {
                          type: "text",
                          text: `${reportBy ?? ""}`,
                          size: "xs",
                          color: "#999999",
                          wrap: true,
                        },
                      ],
                    },
                    ...(reportCompany
                      ? [
                          {
                            type: "box",
                            layout: "vertical",
                            paddingStart: "10px",
                            contents: [
                              {
                                type: "text",
                                text: `${reportCompany}`,
                                size: "xs",
                                color: "#999999",
                                wrap: true,
                                margin: "xs",
                              },
                            ],
                          },
                        ]
                      : []),
                  ],
                }, */

                // ===== รายละเอียด =====
                {
                  type: "box",
                  layout: "baseline",
                  spacing: "sm",
                  paddingStart: "30px",
                  contents: [
                    {
                      type: "text",
                      text: "รายละเอียด:",
                      weight: "bold",
                      size: "xs",
                      flex: 0,
                    },
                    {
                      type: "text",
                      text: `${description ?? ""}`,
                      size: "xs",
                      color: "#333333",
                      wrap: true,
                    },
                  ],
                },

                // ===== ผู้ดูแลเคส =====
                {
                  type: "box",
                  layout: "baseline",
                  spacing: "sm",
                  contents: [
                    { type: "text", text: "👤", size: "sm", flex: 0 },
                    {
                      type: "text",
                      text: "ผู้ดูแลเคส:",
                      weight: "bold",
                      size: "xs",
                      flex: 0,
                    },
                    {
                      type: "text",
                      text: `${actionby ?? ""}`,
                      size: "xs",
                      color: "#999999",
                      wrap: true,
                    },
                  ],
                },

                // ===== เวลาแจ้ง =====
                {
                  type: "box",
                  layout: "baseline",
                  spacing: "sm",
                  contents: [
                    { type: "text", text: "⏳", size: "sm", flex: 0 },
                    {
                      type: "text",
                      text: "เวลาแจ้ง:",
                      weight: "bold",
                      size: "xs",
                      flex: 0,
                    },
                    {
                      type: "text",
                      text: `${notifyAt ?? ""}`,
                      size: "xs",
                      color: "#999999",
                      wrap: true,
                    },
                  ],
                },

                // ===== ข้อความเตือน =====
                {
                  type: "text",
                  text: "“ลูกค้ารอ 5 นาทีแล้ว”",
                  align: "center",
                  weight: "bold",
                  size: "sm",
                  color: "#f4882fff",
                  wrap: true,
                  margin: "sm",
                },

                // ===== ปุ่ม =====
                {
                  type: "box",
                  layout: "vertical",
                  backgroundColor: "#f4882fff",
                  cornerRadius: "10px",
                  paddingAll: "md",
                  action: {
                    type: "uri", // ✅ เปิดเว็บ
                    label: "เปิดเคส",
                    uri: `https://erp.nisolution.co.th/productservice/servicerequest/${
                      TaskNoNew ?? ""
                    }`,
                  },
                  contents: [
                    {
                      type: "text",
                      text: "กรุณาติดต่อกลับลูกค้าโดยเร็ว",
                      align: "center",
                      weight: "bold",
                      size: "md",
                      color: "#FFFFFF",
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
      },
    );

    return true;
  } catch (error) {
    console.error(
      "Error in sendLineToTeamSevice:",
      error.response?.data || error.message,
    );
    return false;
  }
}

async function sendLineToTeamSeviceWaiting(
  TaskNoNew,
  description,
  actionby,
  startDate,
) {
  try {
    let LINE_OA_CHANNEL_ACCESS_TOKEN = null;

    let userId = null;
    let reportBy = "";
    let reportCompany = "";

    const pool = await connectDB();

    let request = pool.request();
    request.input("TaskNo", sql.VarChar(150), TaskNoNew);

    try {
      const result = await request.execute("dbo.getServiceTeam");
      if (result.recordset.length === 0) {
        return res.status(404).json({ message: "Account not found" });
      }
      const { channelToken, userIds, requestby, customername } =
        result.recordset[0];

      LINE_OA_CHANNEL_ACCESS_TOKEN = channelToken;
      userId = userIds;
      reportBy = requestby;
      reportCompany = customername;
      console.log("✅ MSSQL stored procedure executed successfully");
    } catch (e) {
      console.error("❌ MSSQL Error moving file:", e);
    }

    const flexMsgx = {
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
              size: "sm",
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
                      text: `👨🏻‍💻 ดำเนินการโดย: ${actionby ?? ""}`,
                      color: "#aaaaaa",
                      size: "xs",
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

    const flexMsg = {
      type: "flex",
      altText: `Ticket: ${TaskNoNew ?? ""} - กำลังดำเนินการ`,
      contents: {
        type: "bubble",
        size: "kilo",
        body: {
          type: "box",
          layout: "vertical",
          paddingAll: "md",
          contents: [
            {
              // การ์ด (เอา border ออกแล้ว)
              type: "box",
              layout: "vertical",
              paddingAll: "lg",
              backgroundColor: "#FFFFFF",
              cornerRadius: "16px",

              // ✅ ใช้ spacing แทน spacer
              spacing: "md",

              contents: [
                // ===== Header =====
                {
                  type: "box",
                  layout: "baseline",
                  spacing: "sm",
                  contents: [
                    { type: "text", text: "😎", size: "sm", flex: 0 },
                    {
                      type: "text",
                      text: "กำลังดำเนินการ",
                      weight: "bold",
                      size: "sm",
                      color: "#529bc8ff",
                      wrap: true,
                    },
                  ],
                },

                // ===== Ticket =====
                {
                  type: "box",
                  layout: "baseline",
                  spacing: "sm",
                  contents: [
                    { type: "text", text: "🧾", size: "sm", flex: 0 },
                    {
                      type: "text",
                      text: "Ticket:",
                      weight: "bold",
                      size: "sm",
                      flex: 0,
                    },
                    {
                      type: "text",
                      text: `${TaskNoNew ?? ""}`,
                      size: "sm",
                      color: "#999999",
                      wrap: true,
                    },
                  ],
                },
                // ===== ผู้แจ้ง + บริษัท =====
                {
                  type: "box",
                  layout: "vertical",
                  spacing: "xs",
                  contents: [
                    {
                      type: "box",
                      layout: "baseline",
                      spacing: "sm",
                      contents: [
                        { type: "text", text: "👤", size: "sm", flex: 0 },

                        {
                          type: "text",
                          text: `${reportCompany}`,
                          size: "xs",
                          color: "#529bc8ff",
                          wrap: true,
                          weight: "bold",
                        },
                      ],
                    },
                    ...(reportBy
                      ? [
                          {
                            type: "box",
                            layout: "horizontal",
                            paddingStart: "30px",
                            contents: [
                              {
                                type: "text",
                                text: "ผู้แจ้ง:",
                                weight: "bold",
                                size: "xs",
                                flex: 0,
                              },
                              {
                                type: "text",
                                text: `${reportBy}`,
                                size: "xs",
                                color: "#999999",
                                wrap: true,
                                margin: "xs",
                              },
                            ],
                          },
                        ]
                      : []),
                  ],
                },

                // ===== รายละเอียด =====
                {
                  type: "box",
                  layout: "baseline",
                  spacing: "sm",
                  paddingStart: "30px",
                  contents: [
                    {
                      type: "text",
                      text: "รายละเอียด:",
                      weight: "bold",
                      size: "xs",
                      flex: 0,
                    },
                    {
                      type: "text",
                      text: `${description ?? ""}`,
                      size: "xs",
                      color: "#333333",
                      wrap: true,
                    },
                  ],
                },

                // ===== ผู้ดูแลเคส =====
                {
                  type: "box",
                  layout: "baseline",
                  spacing: "sm",
                  contents: [
                    { type: "text", text: "👤", size: "sm", flex: 0 },
                    {
                      type: "text",
                      text: "ผู้ดูแลเคส:",
                      weight: "bold",
                      size: "xs",
                      flex: 0,
                    },
                    {
                      type: "text",
                      text: `${actionby ?? ""}`,
                      size: "xs",
                      color: "#999999",
                      wrap: true,
                    },
                  ],
                },

                // ===== เวลาแจ้ง =====
                {
                  type: "box",
                  layout: "baseline",
                  spacing: "sm",
                  contents: [
                    { type: "text", text: "⏳", size: "sm", flex: 0 },
                    {
                      type: "text",
                      text: "เวลาเริ่มดำเนินการ:",
                      weight: "bold",
                      size: "xs",
                      flex: 0,
                    },
                    {
                      type: "text",
                      text: `${startDate ?? ""}`,
                      size: "xs",
                      color: "#999999",
                      wrap: true,
                    },
                  ],
                },

                // ===== ปุ่ม =====
                {
                  type: "box",
                  layout: "vertical",
                  backgroundColor: "#529bc8ff",
                  cornerRadius: "10px",
                  paddingAll: "md",
                  action: {
                    type: "uri", // ✅ เปิดเว็บ
                    label: "รายละเอียดเคส",
                    uri: `https://erp.nisolution.co.th/productservice/servicerequest/${
                      TaskNoNew ?? ""
                    }`,
                  },
                  contents: [
                    {
                      type: "text",
                      text: "กำลังดำเนินการ",
                      align: "center",
                      weight: "bold",
                      size: "md",
                      color: "#FFFFFF",
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
      },
    );

    return true;
  } catch (error) {
    console.error(
      "Error in sendLineToTeamSevice:",
      error.response?.data || error.message,
    );
    return false;
  }
}

async function sendLineToTeamSeviceFinish(TaskNoNew, issue) {
  try {
    let LINE_OA_CHANNEL_ACCESS_TOKEN = "";

    let userId = "";
    let reporterName = "";
    let reporterCompany = "";
    let reportclosedate = "";
    let reportstartdate = "";
    let reportactionby = "";
    let reportactiondetail = "";
    let reportrequestdate = "";

    const pool = await connectDB();

    let request = pool.request();
    request.input("TaskNo", sql.VarChar(150), TaskNoNew);

    try {
      const result = await request.execute("dbo.getServiceTeamClose");
      if (result.recordset.length === 0) {
        return res.status(404).json({ message: "Account not found" });
      }
      const {
        channelToken,
        userIds,
        requestby,
        customername,
        closedate,
        startdate,
        ActionBy,
        ActionDetail,
        requestdate,
      } = result.recordset[0];

      LINE_OA_CHANNEL_ACCESS_TOKEN = channelToken;
      userId = userIds;
      reporterName = requestby;
      reporterCompany = customername;
      reportrequestdate = requestdate;
      reportstartdate = startdate;
      reportclosedate = closedate;
      reportactionby = ActionBy;
      reportactiondetail = ActionDetail;
      console.log("✅ MSSQL stored procedure executed successfully");
    } catch (e) {
      console.error("❌ MSSQL Error moving file:", e);
    }

    const flexmessage = {
      type: "flex",
      altText: `✅ ปิดเคสเรียบร้อย Ticket: ${TaskNoNew ?? ""}`,
      contents: {
        type: "bubble",
        size: "kilo",
        body: {
          type: "box",
          layout: "vertical",
          paddingAll: "lg",
          backgroundColor: "#FFFFFF",
          cornerRadius: "16px",

          // ✅ ใช้ spacing แทน spacer
          spacing: "md",

          contents: [
            // ===== Header =====
            {
              type: "box",
              layout: "baseline",
              spacing: "sm",
              contents: [
                { type: "text", text: "😊", size: "sm", flex: 0 },
                {
                  type: "text",
                  text: "ปิดเคสเรียบร้อย",
                  weight: "bold",
                  size: "sm",
                  color: "#66BB6A",
                  wrap: true,
                },
              ],
            },

            // ===== Ticket =====
            {
              type: "box",
              layout: "baseline",
              spacing: "sm",
              contents: [
                { type: "text", text: "🧾", size: "sm", flex: 0 },
                {
                  type: "text",
                  text: "Ticket:",
                  weight: "bold",
                  size: "sm",
                  flex: 0,
                },
                {
                  type: "text",
                  text: `${TaskNoNew ?? ""}`,
                  size: "sm",
                  color: "#999999",
                  wrap: true,
                },
              ],
            },

            // ===== ผู้แจ้ง + บริษัท (2 บรรทัด) =====

            {
              type: "box",
              layout: "vertical",
              margin: "sm",
              spacing: "xs",
              contents: [
                {
                  type: "box",
                  layout: "baseline",
                  spacing: "sm",
                  contents: [
                    { type: "text", text: "👤", size: "sm", flex: 0 },

                    {
                      type: "text",
                      text: `${reporterCompany ?? ""}`,
                      size: "xs",
                      color: "#66BB6A",
                      weight: "bold",
                      wrap: true,
                    },
                  ],
                },

                ...(reporterName
                  ? [
                      {
                        type: "box",
                        layout: "horizontal",
                        paddingStart: "30px",
                        contents: [
                          {
                            type: "text",
                            text: "ผู้แจ้ง:",
                            weight: "bold",
                            size: "xs",
                            flex: 0,
                          },
                          {
                            type: "text",
                            text: `${reporterName ?? ""}`,
                            size: "xs",
                            color: "#999999",
                            wrap: true,
                          },
                        ],
                      },
                    ]
                  : []),
              ],
            },
            /* {
              type: "box",
              layout: "vertical",
              margin: "sm",
              spacing: "xs",
              contents: [
                {
                  type: "box",
                  layout: "baseline",
                  spacing: "sm",
                  contents: [
                    { type: "text", text: "👤", size: "sm", flex: 0 },
                    {
                      type: "text",
                      text: "ผู้แจ้ง:",
                      weight: "bold",
                      size: "xs",
                      flex: 0,
                    },
                    {
                      type: "text",
                      text: `${reporterName ?? ""}`,
                      size: "xs",
                      color: "#999999",
                      wrap: true,
                    },
                  ],
                },

                ...(reporterCompany
                  ? [
                      {
                        type: "box",
                        layout: "vertical",
                        paddingStart: "10px",
                        contents: [
                          {
                            type: "text",
                            text: `${reporterCompany}`,
                            size: "xs",
                            color: "#999999",
                            wrap: true,
                            margin: "xs",
                          },
                        ],
                      },
                    ]
                  : []),
              ],
            }, */

            // ===== รายละเอียด =====
            {
              type: "box",
              layout: "baseline",
              spacing: "xs",
              margin: "xs",
              paddingStart: "30px",
              contents: [
                {
                  type: "text",
                  text: "รายละเอียด:",
                  weight: "bold",
                  size: "xs",
                  flex: 0,
                },
                {
                  type: "text",
                  text: `${issue ?? ""}`,
                  size: "xs",
                  color: "#333333",
                  wrap: true,
                },
              ],
            },

            // ===== ผู้ดูแลเคส =====
            {
              type: "box",
              layout: "baseline",
              spacing: "xs",
              margin: "xs",
              contents: [
                { type: "text", text: "👨🏻‍💻", size: "sm", flex: 0 },
                {
                  type: "text",
                  text: "ผู้ดูแลเคส:",
                  weight: "bold",
                  size: "xs",
                  flex: 0,
                },
                {
                  type: "text",
                  text: `${reportactionby ?? ""}`,
                  size: "xs",
                  color: "#999999",
                  wrap: true,
                },
              ],
            },

            // ===== รายงาน =====
            {
              type: "box",
              layout: "baseline",
              spacing: "xs",
              margin: "xs",
              contents: [
                { type: "text", text: "🚩", size: "sm", flex: 0 },
                {
                  type: "text",
                  text: "รายงาน:",
                  weight: "bold",
                  size: "xs",
                  flex: 0,
                },
                {
                  type: "text",
                  text: `${reportactiondetail ?? ""}`,
                  size: "xs",
                  color: "#333333",
                  wrap: true,
                },
              ],
            },

            // ===== ระยะเวลา =====
            {
              type: "box",
              layout: "vertical",
              margin: "sm",
              spacing: "xs",
              contents: [
                {
                  type: "box",
                  layout: "baseline",
                  spacing: "sm",
                  contents: [
                    { type: "text", text: "⏳", size: "sm", flex: 0 },
                    {
                      type: "text",
                      text: "ระยะเวลา:",
                      weight: "bold",
                      size: "xs",
                      flex: 0,
                    },
                    { type: "text", text: " ", size: "sm", flex: 1 },
                  ],
                },
                {
                  type: "box",
                  layout: "vertical",
                  paddingStart: "10px",
                  margin: "xs",
                  spacing: "xs",
                  contents: [
                    {
                      type: "text",
                      text: `เวลาแจ้ง: ${reportrequestdate ?? ""}`,
                      size: "xs",
                      color: "#999999",
                      wrap: true,
                    },
                    {
                      type: "text",
                      text: `เวลาเริ่มดำเนินการ: ${reportstartdate ?? ""}`,
                      size: "xs",
                      color: "#999999",
                      wrap: true,
                    },
                    {
                      type: "text",
                      text: `เวลาปิดงาน: ${reportclosedate ?? ""}`,
                      size: "xs",
                      color: "#999999",
                      wrap: true,
                    },
                  ],
                },
              ],
            },

            // ===== ปุ่มเขียว =====
            {
              type: "box",
              layout: "vertical",
              backgroundColor: "#66BB6A",
              cornerRadius: "10px",
              paddingAll: "md",
              action: {
                // ถ้าต้องการเปิดลิงก์ให้ใช้ uri
                type: "uri",
                label: "ปิดเคสเรียบร้อยแล้ว",
                uri: `https://erp.nisolution.co.th/productservice/servicerequest/${
                  TaskNoNew ?? ""
                }`,
              },
              contents: [
                {
                  type: "text",
                  text: "ปิดเคสเรียบร้อยแล้ว",
                  align: "center",
                  weight: "bold",
                  size: "md",
                  color: "#FFFFFF",
                  wrap: true,
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
        messages: [flexmessage],
      },
      {
        headers: {
          Authorization: `Bearer ${LINE_OA_CHANNEL_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      },
    );

    return true;
  } catch (error) {
    console.error(
      "Error in sendLineToTeamSevice:",
      error.response?.data || error.message,
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
      urlName,
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("rateProblem error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

exports.checkContact = async (req, res) => {
  try {
    const { userId, company, branch, oaId, lineid } = req.body;

    // Validation
    if (!userId || !company || !branch || !oaId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const pool = await connectDB();
    const request = pool.request();

    request.input("UserId", sql.VarChar(150), userId);
    request.input("Company", sql.NVarChar(150), company);
    request.input("Branch", sql.NVarChar(150), branch);
    request.input("LineOAId", sql.VarChar(100), oaId);

    // MSSQL Stored Procedure
    const result = await request.execute("dbo.setContactFormLiffCheck");

    const lineAddFriendUrl = `https://line.me/R/ti/p/${lineid}`;

    return res.status(200).json({
      exists: result.recordset.length > 0,
      result: result.recordset,
      chatUrl: lineAddFriendUrl,
    });
  } catch (err) {
    console.error("saveContact error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

exports.waitsendmsgagent = async () => {
  try {
    const pool = await connectDB();

    // 1) ดึงเคสที่รออยู่ทั้งหมดจาก Stored Procedure
    const spResult = await pool
      .request()
      .execute("dbo.getServiceFormLiFFWaiting");

    const rows = spResult.recordset || [];

    if (!rows.length) {
      console.log(
        "✅ ไม่มีเคสที่รอการแจ้งเตือน (getServiceFormLiFFWaiting ว่างเปล่า)",
      );
    }

    console.log(`⚠️ พบเคสที่รอการแจ้งเตือน ${rows.length} รายการ`);

    // 2) loop ทีละ row
    for (const row of rows) {
      // 👉 ปรับชื่อ field ให้ตรงกับ column ที่ proc คืนมา
      const TaskNoNew = row.TaskNo;
      const userlogin = row.userAssign; // ถ้าอยากใช้ต่อ
      const touserId = row.userId;
      const oaId = row.oaId; // ปรับให้ตรงกับชื่อ column จริง เช่น row.OAId
      const description = row.description || row.Descriptions || ""; // เผื่อชื่อไม่ตรง

      if (!touserId || !oaId) {
        console.warn(
          `⚠️ ข้าม Ticket ${TaskNoNew} เพราะไม่มี userId หรือ oaId (userId=${touserId}, oaId=${oaId})`,
        );
        continue;
      }

      console.log(
        `▶️ กำลังส่งแจ้งเตือน Ticket ${TaskNoNew} ให้ userId=${touserId}, oaId=${oaId}`,
      );

      // 2.1 หา channel token ของ OA จากตาราง CompanySocialChannel
      const tokenResult = await pool
        .request()
        .input("oaid", sql.VarChar(150), oaId).query(`
          SELECT TOP 1 AccessToken AS channelToken 
          FROM [dbo].[CompanySocialChannel]
          WHERE ChannelId = @oaid
        `);

      if (!tokenResult.recordset.length) {
        console.warn(
          `⚠️ ไม่พบ AccessToken สำหรับ OA ${oaId} (Ticket ${TaskNoNew}) ข้ามเคสนี้`,
        );
        continue;
      }

      const { channelToken } = tokenResult.recordset[0];
      const LINE_OA_CHANNEL_ACCESS_TOKEN = channelToken;

      // 2.2 Flex Message สำหรับลูกค้า
      const flexMsg = {
        type: "flex",
        altText: "กรุณารอทีมงานติดต่อกลับ ซักครู่ครับ",
        contents: {
          type: "bubble",
          body: {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "text",
                text: "กรุณารอทีมงานติดต่อกลับ ซักครู่ครับ",
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
                  description && {
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
                ].filter(Boolean),
              },
            ],
          },
        },
      };

      // 2.3 ส่ง push message ให้ลูกค้า
      try {
        await axios.post(
          "https://api.line.me/v2/bot/message/push",
          {
            to: touserId,
            messages: [flexMsg],
          },
          {
            headers: {
              Authorization: `Bearer ${LINE_OA_CHANNEL_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
          },
        );

        console.log(`✅ ส่งข้อความแจ้งเตือนเรียบร้อย Ticket ${TaskNoNew}`);

        // 2.4 ส่งแจ้งเตือนทีมงานผ่านฟังก์ชัน

        await sendLineToTeamSeviceReply(TaskNoNew, description);

        let request = pool.request();
        request.input("TaskNo", sql.VarChar(150), TaskNoNew);

        let newassign = null;
        let displayName = "";
        try {
          const result = await request.execute("dbo.setService_Assign_Chang");
          const { userAssign, userDisplayName } = result.recordset[0];

          newassign = userAssign;
          displayName = userDisplayName;
          console.log("✅ MSSQL stored procedure executed successfully");
        } catch (e) {
          console.error("❌ MSSQL Error moving file:", e);
        }

        const msgNotification = {
          id: uuidv4(),
          type: "linechat",
          title: `มีเคสใหม่ Ticket: ${TaskNoNew} จาก ${displayName} เรื่อง ${description} `,
          category: `มีเคสใหม่ Ticket: ${TaskNoNew} จาก ${displayName} เรื่อง ${description} `,
          isUnRead: true,
          avatarUrl: userId,
          createdAt: bangkokTime, // new Date().toISOString(),
          isUnAlert: true,
          urllink: "/productservice/servicerequest/" + TaskNoNew,
          sendFrom: userId,
          moduleFormName: "/productservice/servicerequest",
          isUnReadMenu: true,
          docNo: TaskNoNew,
          revNo: 0,
        };

        const io = getIO();

        const room = `notification_230015_${newassign}`;

        io.to(room).emit(
          "ReceiveNotification",
          JSON.stringify([msgNotification]),
        );

        let request2 = pool.request();
        request2.input("CmpId", sql.NVarChar(100), "230015");
        request2.input("userTo", sql.NVarChar(100), newassign);
        request2.input("userFrom", sql.NVarChar(100), "0");
        request2.input("id", sql.VarChar(100), TaskNoNew);
        request2.input(
          "Title",
          sql.VarChar(500),
          `มีเคสใหม่ Ticket: ${TaskNoNew} จาก ${displayName} เรื่อง ${description} `,
        );
        request2.input(
          "Category",
          sql.VarChar(500),
          `มีเคสใหม่ Ticket: ${TaskNoNew} จาก ${displayName} เรื่อง ${description} `,
        );
        request2.input("type", sql.VarChar(50), "linechat");
        request2.input(
          "linkTo",
          sql.VarChar(500),
          `/productservice/servicerequest/${TaskNoNew}`,
        );
        request2.input(
          "ModuleFormName",
          sql.VarChar(500),
          "/productservice/servicerequest",
        );
        request2.input("DocNo", sql.VarChar(100), `${TaskNoNew}`);
        request2.input("RevNo", sql.Int, 0);
        request2.input("AvatarUrl", sql.VarChar(100), `${userId}`);

        await request2.execute("dbo.setNotification");
      } catch (err) {
        console.error(
          `❌ ส่ง LINE แจ้งเตือน Ticket ${TaskNoNew} ไม่สำเร็จ:`,
          err.response?.data || err.message,
        );
        // ถ้า ticket ไหนส่งไม่ผ่าน → ยังไม่ return; ไปต่อ ticket ถัดไป
        continue;
      }

      // 👉 ถ้าคุณมี proc เพื่อ mark ว่าบรรทัดนี้ถูกแจ้งแล้ว ให้เรียกต่อท้ายตรงนี้
      // await pool.request().input('TaskNo', sql.VarChar, TaskNoNew).execute('dbo.setServiceFormMarkNotified');
    }
  } catch (err) {
    console.error("Helpdesk error:", err);
  }
};
