import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  try {
    const telegramId = req.query.telegram_id;

    if (!telegramId) {
      return res.status(400).json({
        error: "Falta telegram_id",
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Acceso Premium",
            },
            unit_amount: 1000, // $10.00 USD
          },
          quantity: 1,
        },
      ],
      client_reference_id: telegramId,
      success_url: "https://google.com/success",
      cancel_url: "https://google.com/cancel",
    });

    res.status(200).json({
      checkout_url: session.url,
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
}
