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

exports.pushMessage = async (channelToken, to, messageObject) => {
  try {
    const url = "https://api.line.me/v2/bot/message/push";
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${channelToken}`,
    };
    const body = {
      to,
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
    console.error("Error fetching LINE profile:", error.message);
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
