const axios = require('axios');

exports.sendTextMessage = async (recipientId, text) => {
  try {
    const url = `https://graph.facebook.com/v14.0/me/messages?access_token=${process.env.FB_PAGE_ACCESS_TOKEN}`;
    const payload = {
      messaging_type: 'RESPONSE',
      recipient: { id: recipientId },
      message: { text }
    };
    await axios.post(url, payload);
  } catch (error) {
    console.error('Error sending FB message:', error.response?.data || error.message);
  }
};
