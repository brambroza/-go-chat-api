const axios = require("axios");

exports.replyMessage = async (channelToken, replyToken, messageObject) => {
  try {
    const url = "https://api.line.me/v2/bot/message/reply";
    const url2 = "https://api.line.me/v2/bot/message/push";
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${channelToken}`,
    };
    const body = {
      replyToken,
      messages: [messageObject],
    };
    await axios.post(url, body, { headers });
  } catch (error) {
    console.error(
      "Error in replyMessage:",
      error.response?.data || error.message
    );
  }
};

exports.pushMessage = async (channelToken, to, items = []) => {
  try {
    const url = "https://api.line.me/v2/bot/message/push";
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${channelToken}`,
    };

    console.log("item", items);

    const messages = items.map((item) => {
      switch (item.type) {
        // ✅ ข้อความธรรมดา
        case "text":
          return {
            type: "text",
            text: item.text || "",
          };

        // ✅ รูปภาพ
        case "image":
          return {
            type: "image",
            originalContentUrl: item.url,
            previewImageUrl: item.url,
          };

        // ✅ วิดีโอ
        case "video":
          return {
            type: "video",
            originalContentUrl: item.url,
            previewImageUrl:
              item.thumbnailUrl || "https://example.com/default-thumb.jpg",
          };

        // ✅ ไฟล์เอกสาร (PDF, DOCX, XLSX)
        case "pdf":
        case "doc":
        case "docx":
        case "xls":
        case "xlsx":
          return {
            type: "file",
            fileName: item.fileName || "document.pdf",
            fileSize: item.fileSize || 1024,
            originalContentUrl: item.url,
            previewImageUrl: item.url,
          };

        // ✅ Flex message (custom card)
        case "flex":
          return {
            type: "flex",
            altText: item.altText || "Flex message",
            contents: item.contents,
          };

        default:
          throw new Error(`Unsupported message type: ${item.type}`);
      }
    });

    const body = {
      to,
      messages: messages,
    };

    await axios.post(url, body, { headers });
  } catch (error) {
    console.error(
      "Error in replyMessage:",
      error.response?.data || error.message
    );
  }
};

exports.senLinkdMessageProblem = async (channelToken, userId, text, link) => {
  try {
    const flexmessage = {
      type: "flex",
      altText: `🔈 ${text}`,
      contents: {
        type: "bubble",
        body: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "text",
              text: `🔈 ${text}`,
              weight: "bold",
              size: "lg",
              color: "#e38c29ff",
            },
            {
              type: "text",
              text: `🚩 ต้องการแจ้งปัญหา สามารถกดปุ่มด้านล่างแจ้ง แล้วแจ้งปัญหาได้เลยครับ ขอบคุณครับ.`,
              wrap: true,
              size: "sm",
              color: "#666666",
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
                label: "แจ้งปัญหา",
                uri: link,
              },
              style: "primary",
              position: "relative",
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
          Authorization: `Bearer ${channelToken}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error(
      "Error in replyMessage:",
      error.response?.data || error.message
    );
  }
};

exports.getLineProfile = async (userId, accessToken) => {
  try {
    const response = await axios.get(
      `https://api.line.me/v2/bot/profile/${userId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    return response.data; // { displayName, pictureUrl, language, ... }
  } catch (error) {
    console.log("userId", userId);
    console.error(
      "Error fetching LINE profile:",
      `https://api.line.me/v2/bot/profile/${userId}`
    );
    // Decide how you want to handle errors from the LINE API
    throw error;
  }
};

exports.downloadImage = async (messageId, token) => {
  try {
    const res = await axios.get(
      `https://api-data.line.me/v2/bot/message/${messageId}/content`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        responseType: "arraybuffer",
      }
    );

    const folder = path.join(__dirname, "../uploads/line-images");
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

    const filename = `${uuidv4()}.jpg`;
    const filepath = path.join(folder, filename);
    fs.writeFileSync(filepath, res.data);

    return `/uploads/line-images/${filename}`;
  } catch (error) {
    console.error(
      "Error in downloadImage:",
      error.response?.data || error.message
    );
  }
};
