import Stripe from "stripe";
import { google } from "googleapis";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

export const config = {
  api: {
    bodyParser: false,
  },
};

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("ok");
  }

  let event;

  try {
    const buf = await buffer(req);
    const sig = req.headers["stripe-signature"];

    event = stripe.webhooks.constructEvent(
      buf,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature error:", err.message);
    return res.status(200).send("invalid signature");
  }

  if (event.type !== "checkout.session.completed") {
    return res.status(200).send("ignored");
  }

  const session = event.data.object;
  const telegramId = session.client_reference_id;
  const sessionId = session.id;

  if (!telegramId) {
    return res.status(200).send("missing telegram id");
  }

  // 🔐 Google Sheets auth
  const auth = new google.auth.JWT(
    process.env.GOOGLE_CLIENT_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    ["https://www.googleapis.com/auth/spreadsheets"]
  );

  const sheets = google.sheets({ version: "v4", auth });

  const sheetId = process.env.SHEET_ID;
  const range = "users!A2:E";

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range,
  });

  const rows = response.data.values || [];

  let rowIndex = -1;

  rows.forEach((row, index) => {
    if (row[0] === telegramId) {
      rowIndex = index + 2;
    }
  });

  if (rowIndex === -1) {
    return res.status(200).send("user not found");
  }

  const alreadyProcessed = rows[rowIndex - 2][4];

  if (alreadyProcessed === sessionId) {
    return res.status(200).send("already processed");
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `users!C${rowIndex}:E${rowIndex}`,
    valueInputOption: "RAW",
    requestBody: {
      values: [["active", new Date().toISOString(), sessionId]],
    },
  });

  return res.status(200).send("ok");
}
