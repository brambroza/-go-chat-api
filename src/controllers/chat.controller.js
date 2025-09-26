const { publishToQueue } = require("../config/rabbitmq");
const { connectDB, sql } = require("../config/database");
const lineService = require("../services/line.service");
const fs = require("fs");
const path = require("path");

const { io } = require("../app");

exports.handleLineWebhook = async (req, res) => {
  try {
    const accountId = req.params.accountId;

    if (!accountId || !req.body?.events) {
      return res.status(200).json({ message: "OK (no content to process)" });
    }

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

    /*     const { channelToken } = result.recordset[0];
     */
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

        if (type === "image") {
       

          const volumeBase = "/usr/src/app/uploads";
          const uploadDirnew = path.join(
            volumeBase,
           `${cmpId}/linechat`
          );

          await fs.mkdir(uploadDirnew, { recursive: true });

          try {
            const response = await fetch(
              `https://api-data.line.me/v2/bot/message/${messageId}/content`,
              {
                headers: {
                  Authorization: `Bearer ${replyToken}`,
                },
              }
            );

            if (!response.ok) {
              console.error(`❌ Failed to fetch image ${file.id}`);
              continue;
            }

            const buffer = Buffer.from(await response.arrayBuffer());

            // ตั้งชื่อไฟล์ตาม messageId
            const filename = `${file.id}.jpg`;
            const finalPath = path.join(uploadDirnew, filename);

            fs.writeFileSync(finalPath, buffer);
            console.log(`✅ Saved file: ${finalPath}`);

            // push path กลับไปให้ frontend ใช้
            results.push(`/uploads/line/${filename}`);
          } catch (err) {
            console.error("❌ Error saving image:", err);
          }
        }

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
      userId,
      message,
      type,
      sendbyId,
      id,
      cmpid,
      channelToken,
      stickerId,
      stickerResourceType,
    } = req.body;

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
      userId +
      "'" +
      ",@type='" +
      type +
      "'" +
      ",@replyToken=''" +
      ",@quotaToken=''" +
      ",@text='" +
      message +
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
      cmpId: cmpid,
      userId: userId,
      id: id,
      type: type,
      replyToken: "",
      quotaToken: "",
      text: message,
      timeStamp: utc7Date,
      stickerId: stickerId ?? "-",
      stickerResourceType: stickerResourceType ?? "-",
      sendbyId: sendbyId,
    };

    console.log("event send : ", eventdata);

    io.emit("server_broadcast", {
      from: "LINE",
      event: eventdata,
      userId: userId,
      timestamp: new Date().toISOString(),
    });

    // สามารถ publish ไปยัง RabbitMQ ได้ ถ้าต้องการกระจายข้อมูล real-time
    /*  await publishToQueue("internalChatQueue", { fromUserId, to, message }); */

    const to = userId;
    const messageObject = {
      type: "text",
      text: message,
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

    // Get a connection from your pool
    const pool = await connectDB();

    const dt = await pool
      .request()
      .input("CmpId", cmpid)
      .query("EXEC dbo.getLineFriend @CmpId=@CmpId");

    // The recordset from the query
    const rows = dt.recordset;

    const responseData = [];
    for (const row of rows) {
      const userId = row.UserId;
      const contactToken = row.AccessToken;

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
          branch: row.Branch,
          province: row.Province,
          phone: row.PhoneNo,
          lineOAId: row.LineOAId,
          lineOAName: row.LineOAName,
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

exports.getLineChatConvertsatition = async (req, res) => {
  try {
    const { cmpid } = req.query;

    const pool = await connectDB();

    const dt = await pool
      .request()
      .input("CmpId", cmpid)
      .query("EXEC dbo.getLineFriend @CmpId=@CmpId");

    const dtc = await pool
      .request()
      .input("CmpId", cmpid)
      .query("EXEC dbo.getLineChatConvertsatition @CmpId=@CmpId");

    const conversations = [];

    for (const r of dt.recordset) {
      const rd = {
        cmpId: r.CmpId,
        lineToken: r.AccessToken,
        id: r.UserId,
        type: "text",
        unreadCount: 0,
        messages: [],
        participants: [],
      };

      const userMessages = dtc.recordset.filter((d) => d.userId === rd.id);
      for (const d of userMessages) {
        rd.messages.push({
          id: d.Id,
          userId: rd.id,
          replyToken: d.replyToken,
          quotaToken: d.quotaToken,
          text: d.text,
          type: d.type,
          timestamp: new Date(d.TimeStamp),
        });
      }

      const userRows = dt.recordset.filter((rx) => rx.UserId === rd.id);
      for (const rx of userRows) {
        const profile = await lineService.getLineProfile(
          rx.UserId,
          rd.lineToken
        );

        rd.participants.push({
          userId: rx.UserId,
          displayName: profile.displayName,
          pictureUrl: profile.pictureUrl,
          language: profile.language,
          status: "online",
          lineOAName: rx.lineOAName,
          lineOAId: rx.lineOAName,
          lastActivity: new Date(),
          cmpId: rx.cmpId,
          type: rx.type,
          name: rx.name,
          channelToken: rx.channelToken,
          branch: rx.branch,
          province: rx.province,
          phone: rx.phone,
          customerName: rx.customerName,
          position: rx.position,
        });
      }

      conversations.push(rd);
    }

    res.json(conversations);
  } catch (error) {
    console.error("error getconvertition:::", error);
    return res.status(500).json({ error: "Internal Server Error.." });
  }
};

exports.getChatConvertsationUserId = async (req, res) => {
  const { cmpid, userId } = req.query;

  try {
    const pool = await connectDB();

    const dt = await pool
      .request()
      .input("CmpId", cmpid)
      .input("userId", userId)
      .query("EXEC dbo.getLineFriendUserId @CmpId=@CmpId, @userid=@userId");

    const dtc = await pool
      .request()
      .input("CmpId", cmpid)
      .input("userId", userId)
      .query(
        "EXEC dbo.getLineChatConvertsatitionUserId @CmpId=@CmpId, @userid=@userId"
      );

    const rd = {
      cmpid,
      id: userId,
      type: "text",
      unreadCount: 0,
      messages: [],
      participants: [],
    };

    let accessToken = "";

    // 🔁 แปลงข้อความ
    const messages = dtc.recordset.filter((d) => d.userId === userId);
    for (const d of messages) {
      accessToken = d.AccessToken;
      const msg = {
        id: d.Id,
        userId: d.chatId,
        lineToken: d.AccessToken,
        replyToken: d.replyToken,
        quotaToken: d.quotaToken,
        text: d.text,
        type: d.type,
        timestamp: new Date(d.TimeStamp),
        attachments: [],
      };

      if (msg.type === "image") {
        const url = await lineService.downloadImage(msg.id, msg.lineToken);
        msg.attachments.push({
          id: msg.id,
          url,
          createdAt: msg.timestamp,
          type: "image",
        });
      }

      if (msg.type === "sticker") {
        msg.attachments.push({
          id: msg.id,
          url: "",
          createdAt: msg.timestamp,
          type: "sticker",
          stickerId: d.stickerId,
          stickerType: d.stickerResourceType,
        });
      }

      rd.messages.push(msg);
    }

    // 👤 participants
    const userRows = dt.recordset.filter((rx) => rx.UserId === userId);
    for (const rx of userRows) {
      const prof = await lineService.getLineProfile(rx.UserId, rx.channelToken);

      rd.participants.push({
        userId: rx.UserId,
        displayName: prof.displayName,
        pictureUrl: prof.pictureUrl,
        language: prof.language,
        status: "online",
        lineOAName: rx.lineOAName,
        lineOAId: rx.lineOAName,
        lastActivity: new Date(),
        cmpId: rx.cmpId,
        type: rx.type,
        name: rx.name,
        channelToken: rx.channelToken,
        branch: rx.branch,
        province: rx.province,
        phone: rx.phone,
        customerName: rx.customerName,
        position: rx.position,
      });
    }

    res.json(rd);
  } catch (err) {
    console.error("Error:", err);
    res.status(500).send("Internal Server Error");
  }
};
