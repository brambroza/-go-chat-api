const axios = require("axios");

const fs = require("fs");
const path = require("path");
 

const { generateAndUploadThumb } = require("./thumb.service");

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
      error.response?.data || error.message,
    );
  }
};

exports.pushMessage = async (channelToken, to, items = [], id) => {
  try {
    const url = "https://api.line.me/v2/bot/message/push";
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${channelToken}`,
    };

    console.log("item", items);

    const messages = (
      await Promise.all(
        items.map(async (item) => {
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
            case "video": {
              let preview = item.thumbnailUrl;

              if (!preview) {
                const { thumbUrl } = await generateAndUploadThumb(item.url, {
                  thumb: { seekSeconds: 1, width: 480, quality: 75 },
                  upload: {
                    cmpId: "230015",
                    messageId: id, // หรือ messageId จริงของ LINE ก็ได้
                    volumeBase: "/usr/src/app/uploads",
                    subDir: "linechat",
                    publicBaseUrl: "https://api.nisolution.co.th", // ต้อง map ให้ยิงไฟล์จาก path นี้ได้
                  },
                  cleanup: true,
                });

                preview = thumbUrl;

                console.log("preview", preview);
                console.log("previewid", id);
              }

              return {
                type: "video",
                originalContentUrl: item.url,
                previewImageUrl: preview,
              };
            }

            /*   return {
            type: "video",
            originalContentUrl: item.url,
            previewImageUrl:
               "https://api.nisolution.co.th/230015/serviceproblem/2500268s/d19c77eb-1452-451e-b069-c900d7e41e83.jpg",
          }; */

            // ✅ ไฟล์เอกสาร (PDF, DOCX, XLSX)
            case "pdf":
            case "word":
            case "docx":
            case "xls":
            case "xlsx":
            case "txt":
            case "excel":
              const safeUrl = encodeURI(item.url);
              return {
                type: "template",
                altText: `ไฟล์เอกสาร: ${item.fileName}`,
                template: {
                  type: "buttons",
                  title: "📎 ดาวน์โหลดไฟล์",
                  text: item.fileName,
                  actions: [
                    {
                      type: "uri",
                      label: "ดาวน์โหลด",
                      uri: safeUrl,
                    },
                  ],
                },
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
        }),
      )
    ).filter((m) => m && m.type);

    const body = {
      to,
      messages: messages,
    };

    await axios.post(url, body, { headers });
  } catch (error) {
    console.error(
      "Error in replyMessage:",
      error.response?.data || error.message,
    );
  }
};

exports.senLinkdMessageProblem = async (channelToken, userId, text, link) => {
  try {
    /* const flexmessage = {
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
              text: `🚩 ต้องการแจ้งปัญหา สามารถกดปุ่มด้านล่าง ขอบคุณครับ.`,
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
    }; */

    const flexmessage = {
      type: "flex",
      altText: "🔔 แจ้งปัญหาการใช้งาน",
      contents: {
        type: "bubble",
        body: {
          type: "box",
          layout: "vertical",
          paddingAll: "16px",
          contents: [
            {
              type: "text",
              text: "🔔 แจ้งปัญหาการใช้งาน",
              weight: "bold",
              size: "lg",
              color: "#e38c29",
              margin: "sm",
            },
            {
              type: "text",
              text: "🚩 หากท่านพบปัญหาในการใช้งาน สามารถกดปุ่ม “แจ้งปัญหา” ด้านล่างเพื่อส่งรายละเอียดถึงเจ้าหน้าที่",
              wrap: true,
              size: "sm",
              color: "#333333",
              margin: "md",
            },
            {
              type: "text",
              text: "👨🏻‍💻 ทีมงานจะตรวจสอบและติดต่อกลับโดยเร็วที่สุด",
              wrap: true,
              size: "sm",
              color: "#333333",
              margin: "md",
            },
            {
              type: "text",
              text: "🕒 เวลารับแจ้งปัญหา:  \r\n     วันจันทร์ – ศุกร์ เวลา 08:30 – 17:30 น.  \r\n     ยกเว้นวันหยุดนักขัตฤกษ์",
              wrap: true,
              size: "sm",
              color: "#333333",
              margin: "md",
            },
          ],
        },
        footer: {
          type: "box",
          layout: "vertical",
          spacing: "md",
          contents: [
            {
              type: "button",
              style: "primary",
              action: {
                type: "uri",
                label: "แจ้งปัญหา",
                uri: "https://liff.line.me/2008264962-5GjEvk92",
              },
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
      },
    );
  } catch (error) {
    console.error(
      "Error in replyMessage:",
      error.response?.data || error.message,
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
      },
    );
    return response.data; // { displayName, pictureUrl, language, ... }
  } catch (error) {
    console.log("userId", userId);
    console.error(
      "Error fetching LINE profile:",
      `https://api.line.me/v2/bot/profile/${userId}`,
    );
    // Decide how you want to handle errors from the LINE API
    throw error;
  }
};

 
exports.getLineProfileWithRetry = async (userId, accessToken, maxRetry = 3) => {
  const token = (accessToken || "").trim(); // ✅ กัน space

  let lastError = null;

  for (let attempt = 0; attempt <= maxRetry; attempt++) {
    try {
      const res = await axios.get(
        `https://api.line.me/v2/bot/profile/${userId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 8000,
        },
      );

      return res.data; // ✅ { displayName, pictureUrl, language, ... }
    } catch (err) {
      const status = err?.response?.status;
      const body = err?.response?.data;
      lastError = err;

      console.log(
        `[LINE] get-friend-profile :::: userId=${userId} attempt=${attempt}/${maxRetry} status=${status}`,
      );
      if (body) console.log("[LINE] errorBody:", body);

      // ❌ token ผิด ไม่ต้อง retry
      if (status === 401) {
        throw new Error(`LINE 401 Unauthorized (token invalid or expired)`);
      }

      // ✅ 404 / 429: รอ 2 วิแล้วลองใหม่ (ถ้ายังเหลือรอบ)
      if ((status === 404 || status === 429) && attempt < maxRetry) {
        await delay(2000);
        continue;
      }

      // ❌ error อื่นๆ หรือ retry ครบแล้ว -> throw
      throw err;
    }
  }

  // กันหลุด (ปกติไม่ถึง)
  throw lastError || new Error("Unknown LINE profile error");
};

exports.downloadImage = async (messageId, token) => {
  try {
    const volumeBase = "/usr/src/app/uploads";
    const folder = path.join(volumeBase, `fromline/line-images`);

    const filename = `${messageId}.jpg`;
    const filepath = path.join(folder, filename);

    // ✅ ถ้ามีไฟล์อยู่แล้ว ไม่ต้องโหลดซ้ำ
    try {
      await fs.access(filepath);
      console.log(`⚡ ใช้ไฟล์ที่มีอยู่แล้ว: ${filepath}`);
      return `/fromline/line-images/${filename}`;
    } catch {
      // file ไม่เจอ → ไปโหลดใหม่
    }

    const res = await fetch(
      `https://api-data.line.me/v2/bot/message/${messageId}/content`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    if (!res.ok) {
      console.error(`❌ Failed to fetch image ${file.id}`);
      return;
    }

    const buffer = Buffer.from(await res.arrayBuffer());

    await fs.mkdir(folder, { recursive: true }, (err) => {
      if (err) {
        console.error("❌ Error creating directory:", err);
        return;
      }

      fs.writeFileSync(filepath, buffer, (err) => {
        if (err) {
          console.error("❌ Error moving file:", err);
          return;
        }
        console.log("✅ File moved successfully");
      });
    });

    return `/fromline/line-images/${filename}`;
  } catch (error) {
    console.error(
      "Error in downloadImage:",
      error.response?.data || error.message,
    );
  }
};

exports.downloadVideo = async (messageId, token) => {
  try {
    const volumeBase = "/usr/src/app/uploads";
    const folder = path.join(volumeBase, "fromline/line-video");
    const filename = `${messageId}.mp4`;
    const filepath = path.join(folder, filename);

    // ✅ ถ้ามีไฟล์อยู่แล้ว ไม่ต้องโหลดซ้ำ
    try {
      await fs.access(filepath);
      console.log(`⚡ ใช้ไฟล์ที่มีอยู่แล้ว: ${filepath}`);
      return `/fromline/line-video/${filename}`;
    } catch {
      // file ไม่เจอ → ไปโหลดใหม่
    }

    const res = await fetch(
      `https://api-data.line.me/v2/bot/message/${messageId}/content`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    if (!res.ok) {
      console.error(`❌ Failed to fetch image ${file.id}`);
      return;
    }

    const buffer = Buffer.from(await res.arrayBuffer());

    await fs.mkdir(folder, { recursive: true }, (err) => {
      if (err) {
        console.error("❌ Error creating directory:", err);
        return;
      }

      fs.writeFileSync(filepath, buffer, (err) => {
        if (err) {
          console.error("❌ Error moving file:", err);
          return;
        }
        console.log("✅ File moved successfully");
      });
    });

    return `/fromline/line-video/${filename}`;
  } catch (error) {
    console.error(
      "Error in downloadvideo:",
      error.response?.data || error.message,
    );
  }
};
