const axios = require('axios');

exports.replyMessage = async (channelToken, replyToken, messageObject) => {
  try {
    const url = 'https://api.line.me/v2/bot/message/reply';
    const url2 = "https://api.line.me/v2/bot/message/push";
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${channelToken}`
    };
    const body = {
      replyToken,
      messages: [messageObject]
    };
    await axios.post(url, body, { headers });
  } catch (error) {
    console.error('Error in replyMessage:', error.response?.data || error.message);
  }
};


exports.pushMessage = async (channelToken,to ,  messageObject) => {
  try {
    const url = "https://api.line.me/v2/bot/message/push";
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${channelToken}`
    };
    const body = {
      to,  
      messages: [messageObject]  
    };

    await axios.post(url, body, { headers });
  } catch (error) {
    console.error('Error in replyMessage:', error.response?.data || error.message);
  }
};



exports.getLineProfile = async (userId , accessToken) => {
  try {
    const response = await axios.get(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    return response.data; // { displayName, pictureUrl, language, ... }
  } catch (error) {
    console.error("Error fetching LINE profile:", error.message);
    // Decide how you want to handle errors from the LINE API
    throw error;
  }
};