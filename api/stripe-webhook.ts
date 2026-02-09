import { buffer } from 'micro'
import Stripe from 'stripe'
import { google } from 'googleapis'

export const config = {
  api: { bodyParser: false }
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16'
})

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).end()
  }

  const sig = req.headers['stripe-signature']
  const buf = await buffer(req)

  let event
  try {
    event = stripe.webhooks.constructEvent(
      buf,
      sig!,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch (err) {
    return res.status(200).end()
  }

  if (event.type !== 'checkout.session.completed') {
    return res.status(200).end()
  }

  const session = event.data.object
  const telegramId = session.client_reference_id
  if (!telegramId) return res.status(200).end()

  const auth = new google.auth.JWT(
    process.env.GOOGLE_CLIENT_EMAIL,
    undefined,
    process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  )

  const sheets = google.sheets({ version: 'v4', auth })

  const sheetId = process.env.SHEET_ID
  const range = 'users!A2:I'

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range
  })

  const rows = response.data.values || []

  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === telegramId) {
      if (rows[i][7] === event.id) {
        return res.status(200).end()
      }

      rows[i][3] = 'active'
      rows[i][5] = session.customer
      rows[i][6] = session.subscription
      rows[i][7] = event.id
      rows[i][8] = new Date().toISOString()

      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `users!A${i + 2}:I${i + 2}`,
        valueInputOption: 'RAW',
        requestBody: { values: [rows[i]] }
      })

      break
    }
  }

  return res.status(200).end()
}
