import "dotenv/config";
import fs from "node:fs";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const envPath = ".env";
const amountCents = Number(process.env.STRIPE_RESERVATION_DEPOSIT_AMOUNT_CENTS || "10000");
const currency = (process.env.STRIPE_RESERVATION_DEPOSIT_CURRENCY || "usd").toLowerCase();
const companyName = process.env.COMPANY_NAME || "Your Restaurant";

if (!stripeSecretKey) {
  throw new Error("STRIPE_SECRET_KEY is required. Use a Stripe test key, for example sk_test_...");
}

if (!stripeSecretKey.startsWith("sk_test_")) {
  throw new Error("Refusing to configure Stripe with a live key. Set STRIPE_SECRET_KEY to a sk_test_... key.");
}

if (!Number.isInteger(amountCents) || amountCents <= 0) {
  throw new Error("STRIPE_RESERVATION_DEPOSIT_AMOUNT_CENTS must be a positive integer.");
}

async function stripePost(path: string, params: URLSearchParams) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${stripeSecretKey}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: params
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Stripe ${path} failed: ${response.status} ${response.statusText} ${text}`);
  }

  return JSON.parse(text) as Record<string, unknown>;
}

const params = new URLSearchParams({
  "line_items[0][price_data][currency]": currency,
  "line_items[0][price_data][unit_amount]": String(amountCents),
  "line_items[0][price_data][product_data][name]": `${companyName} reservation deposit`,
  "line_items[0][price_data][product_data][description]": "Test-mode reservation deposit collected after a phone reservation inquiry.",
  "line_items[0][quantity]": "1",
  "metadata[source]": "ycagentphone",
  "metadata[purpose]": "reservation_deposit",
  "payment_intent_data[metadata][source]": "ycagentphone",
  "payment_intent_data[metadata][purpose]": "reservation_deposit"
});

const paymentLink = await stripePost("payment_links", params);
const paymentLinkUrl = typeof paymentLink.url === "string" ? paymentLink.url : undefined;

if (!paymentLinkUrl) {
  throw new Error("Stripe did not return a payment link URL.");
}

if (fs.existsSync(envPath)) {
  let env = fs.readFileSync(envPath, "utf8");
  const line = `STRIPE_RESERVATION_PAYMENT_LINK_URL=${paymentLinkUrl}`;
  if (/^STRIPE_RESERVATION_PAYMENT_LINK_URL=/m.test(env)) {
    env = env.replace(/^STRIPE_RESERVATION_PAYMENT_LINK_URL=.*$/m, line);
  } else {
    env += `\n${line}\n`;
  }
  fs.writeFileSync(envPath, env);
}

console.log("Stripe test reservation deposit payment link configured.");
console.log(`Amount: ${(amountCents / 100).toFixed(2)} ${currency.toUpperCase()}`);
console.log(`Payment link: ${paymentLinkUrl}`);
if (fs.existsSync(envPath)) {
  console.log("Updated STRIPE_RESERVATION_PAYMENT_LINK_URL in .env.");
}
