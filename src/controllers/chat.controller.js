const { publishToQueue } = require("../config/rabbitmq");
const { connectDB, sql } = require("../config/database");
const lineService = require("../services/line.service");

const { io } = require("../app");

exports.handleLineWebhook = async (req, res) => {
  try {
    const accountId = req.params.accountId;

    console.log("Received from IP:", req);
    console.log("webhook result:", req.body);
    console.log("webhook result:", req.body.events);
    // อ่าน event จาก req.body.events (Line messaging API)
    const events = req.body.events;

    // ดึงข้อมูล channel token/secret จาก DB ตาม accountId
    const pool = await connectDB();
    const result = await pool
      .request()
      .input("accountId", sql.VarChar, accountId).query(`
        SELECT ChannelId,AccessToken as channelToken 
        FROM [dbo].[CompanySocialChannel]
        WHERE Name = @accountId
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: "Account not found" });
    }

    const { channelToken } = result.recordset[0];

    // ตรวจสอบ signature ตามแนวทางของ Line API (ถ้าต้องการ)
    // lineService.verifySignature(req.headers['x-line-signature'], body, channelSecret) ...

    // ประมวลผลข้อความ หรือจะส่งต่อเข้าสู่คิว RabbitMQ ก็ได้

    for (let event of events) {
      // 1) บันทึกลง DB หรือ
      // 2) ส่งต่อให้ Service ประมวลผล
      // 3) หรือ Publish ลง RabbitMQ

      // ตัวอย่างตอบกลับข้อความ (reply)
      if (event.type === "message") {
        const cmpId = "230015";
        const timestamp = event.timestamp;
        const messageId = event.message.id;
        const userId = event.source.userId;
        const type = event.message.type;
        const replyToken = event.replyToken;
        const quotaToken = event.message.quoteToken || "";
        const text = event.message.text || "";
        const stickerId = event.message.stickerId || "-";
        const stickerResourceType = event.message.stickerResourceType || "-";

        // 1) เชื่อมต่อ MSSQL

        const pool = await connectDB();
        // 2) เรียก Stored Procedure หรือ Query ตรง ๆ ก็ได้
        let request = pool.request();
        request.input("CmpId", sql.VarChar(10), cmpId);
        request.input("TimeStamp", sql.BigInt, timestamp);
        request.input("id", sql.VarChar(50), messageId);
        request.input("userId", sql.VarChar(50), userId);
        request.input("type", sql.VarChar(50), type);
        request.input("replyToken", sql.VarChar(50), replyToken);
        request.input("quotaToken", sql.VarChar(200), quotaToken);
        request.input("text", sql.NVarChar(sql.MAX), text);
        request.input("stickerId", sql.VarChar(50), stickerId);
        request.input(
          "stickerResourceType",
          sql.VarChar(50),
          stickerResourceType
        );

        const result = await request.execute("dbo.setLineChatMessage");

        console.log("MSSQL result:", result);

        const date = new Date();

        // Get current time in milliseconds
        const utcTime = date.getTime();

        // Calculate the offset in milliseconds (7 hours)
        const offset = 7 * 60 * 60 * 1000;

        // Create a new Date object with the offset
        const utc7Date = new Date(utcTime + offset);

        const eventdata = {
          cmpId: "230015",
          userId: userId,
          id: messageId,
          type: type,
          replyToken: replyToken,
          quotaToken: quotaToken,
          text: text,
          timeStamp: utc7Date,
          stickerId: stickerId,
          stickerResourceType: stickerResourceType,
          sendbyId: "-",
        };

        io.emit("server_broadcast", {
          from: "LINE",
          event: eventdata,
          userId: userId,
          timestamp: new Date().toISOString(),
        });
        io.emit("server_broadcast", {
          id: messageId,
          userId: userId,
          type: "LINE",
          replyToken: replyToken,
          quotaToken: quotaToken,
          text: text,
          timestamp: new Date().toISOString(),
          attachments: stickerResourceType,
        });

        /*  await publishToQueue("lineQueue", { accountId, event }); */

        /* await lineService.replyMessage(channelToken, event.replyToken, {
          type: "text",
          text: "Hello from webhook!",
        }); */
      }
    }

    return res.status(200).json({ message: "OK" });
  } catch (error) {
    console.error("Line Webhook Error:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

exports.sendMessage = async (req, res) => {
  try {
    const {
      UserId,
      Message,
      type,
      sendbyId,
      id,
      cmpid,
      channelToken,
      stickerId,
      stickerResourceType,
    } = req.body;

    const fromUserId = req.user.userId; // ได้จาก JWT

    // อาจจะบันทึกลง DB ก่อน
    const pool = await connectDB();

    // Build the SQL command string
    let cmd =
      "EXEC dbo.setLineChatMessage" +
      " @CmpId='" +
      cmpid +
      "'" +
      ",@TimeStamp=0" +
      ",@id='" +
      id +
      "'" +
      ",@userId='" +
      UserId +
      "'" +
      ",@type='" +
      type +
      "'" +
      ",@replyToken=''" +
      ",@quotaToken=''" +
      ",@text='" +
      Message +
      "'" +
      ",@stickerId=''" +
      ",@stickerResourceType=''" +
      ",@sendbyId='" +
      sendbyId +
      "'";

    // Execute the query
    await pool.request().query(cmd);

    const date = new Date();

    // Get current time in milliseconds
    const utcTime = date.getTime();

    // Calculate the offset in milliseconds (7 hours)
    const offset = 7 * 60 * 60 * 1000;

    // Create a new Date object with the offset
    const utc7Date = new Date(utcTime + offset);

    const eventdata = {
      cmpId: "230015",
      userId: UserId,
      id: id,
      type: type,
      replyToken: "",
      quotaToken: "",
      text: Message,
      timeStamp: utc7Date,
      stickerId: stickerId ?? "-",
      stickerResourceType: stickerResourceType ?? "-",
      sendbyId: sendbyId,
    };

    console.log("event send : ", eventdata);

    io.emit("server_broadcast", {
      from: "LINE",
      event: eventdata,
      userId: UserId,
      timestamp: new Date().toISOString(),
    });

    // สามารถ publish ไปยัง RabbitMQ ได้ ถ้าต้องการกระจายข้อมูล real-time
    /*  await publishToQueue("internalChatQueue", { fromUserId, to, message }); */

    const to = UserId;
    const messageObject = {
      type: "text",
      text: Message,
    };

    await lineService.pushMessage(channelToken, to, messageObject);

    return res.status(200).json({ message: "Message sent." });
  } catch (error) {
    console.error("sendMessage error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getMessages = async (req, res) => {
  try {
    const { userid, cmpid } = req.query;

    const pool = await connectDB();

    const cmd = `EXEC dbo.getLineChatConvertsatitionUserId @CmpId='${cmpid}' , @userId='${userid}'`;
    const dbResult = await pool.request().query(cmd);
    return res.json(dbResult.recordset);
  } catch (error) {
    console.error("getMessages error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getMessagesTitle = async (req, res) => {
  try {
    const { cmpid } = req.query;

    const pool = await connectDB();

    const cmd = `EXEC dbo.getLineChatTitle @CmpId='${cmpid}' `;
    const dbResult = await pool.request().query(cmd);
    return res.json(dbResult.recordset);
  } catch (error) {
    console.error("getMessages title error:", error);
    return res
      .status(500)
      .json({ message: " get message title  Internal server error" });
  }
};

exports.getLineFriend = async (req, res) => {
  try {
    const { cmpid } = req.query;
    if (!cmpid) {
      return res.status(400).json({ error: "cmpid is required" });
    }

    // Build the T-SQL command, just like in .NET
    const cmd = `exec dbo.getLineFriend @CmpId='${cmpid}'`;

    // Get a connection from your pool
    const pool = await connectDB();
    // Execute the query
    const result = await pool.request().query(cmd);

    // The recordset from the query
    const rows = result.recordset;

    // Prepare the final result array
    const responseData = [];
 //a.CmpId , a.UserId , a.Type , a.Branch , a.Province ,a.PhoneNo , a.LineOAId , a.Name
//	, c.Name as LineOAName , c.AccessToken
    for (const row of rows) {
      const userId = row.UserId;
      const contactToken = row.AccessToken;
      // Call the LINE API to get the profile
      try {
        const lineProfile = await lineService.getLineProfile(
          userId,
          contactToken
        );
        responseData.push({
          cmpId: row.CmpId,
          userId: userId,
          displayName: lineProfile.displayName,
          pictureUrl: lineProfile.pictureUrl,
          language: lineProfile.language,
          type: row.type,
          name: row.Name,
          channelToken: contactToken,
          branch : row.Branch, 
          province : row.Province, 
          phone : row.PhoneNo, 
          lineOAId : row.LineOAId , 
          lineOAName : row.LineOAName ,

        });
      } catch (err) {
        // Decide how you want to handle errors from the LINE API
        console.error("Failed to get profile for user:", userId, err.message);
        // You could push partial data or skip this user
        // For example, push partial data:
        responseData.push({
          cmpId: row.CmpId,
          userId: userId,
          displayName: null,
          pictureUrl: null,
          language: null,
          channelToken: contactToken,
          error: "Failed to retrieve profile",
        });
      }
    }

    return res.json(responseData);
  } catch (error) {
    console.error("Error in getLineFriend route:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};
