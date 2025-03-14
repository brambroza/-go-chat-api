const { google } = require("googleapis");
require("dotenv").config();

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

oauth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });

async function listEmails() {
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  const res = await gmail.users.messages.list({
    userId: "me",
    maxResults: 5, // Fetch latest 5 emails
  });

  if (!res.data.messages) {
    console.log("No emails found.");
    return;
  }

  for (const msg of res.data.messages) {
    const email = await gmail.users.messages.get({
      userId: "me",
      id: msg.id,
    });

    const subject = email.data.payload.headers.find(h => h.name === "Subject")?.value;
    console.log(`- ${subject}`);
  }
}

listEmails().catch(console.error);
