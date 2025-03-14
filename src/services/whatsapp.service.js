const axios = require('axios');

exports.sendTextMessage = async (phoneNumber, text) => {
  try {
    const url = `https://graph.facebook.com/v14.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
    const data = {
      messaging_product: 'whatsapp',
      to: phoneNumber,
      text: { body: text }
    };
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`
    };
    await axios.post(url, data, { headers });
  } catch (error) {
    console.error('Error sending WhatsApp message:', error.response?.data || error.message);
  }
};
