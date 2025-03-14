const { google } = require("googleapis");
const readline = require("readline-sync");
require("dotenv").config();

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

const SCOPES = ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly"];

async function getAccessToken() {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });

  console.log("Authorize this app by visiting this URL:", authUrl);
  const code = readline.question("Enter the code from the page: ");

  const { tokens } = await oauth2Client.getToken(code);
  console.log("Your Refresh Token:", tokens.refresh_token);
}

getAccessToken();
