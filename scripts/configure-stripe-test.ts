import "dotenv/config";
import fs from "node:fs";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const envPath = ".env";
const standardAmountCents = Number(process.env.STRIPE_STANDARD_RESERVATION_DEPOSIT_AMOUNT_CENTS || "2000");
const largePartyAmountCents = Number(process.env.STRIPE_LARGE_PARTY_RESERVATION_DEPOSIT_AMOUNT_CENTS || "10000");
const currency = (process.env.STRIPE_RESERVATION_DEPOSIT_CURRENCY || "usd").toLowerCase();
const companyName = process.env.COMPANY_NAME || "Your Restaurant";

if (!stripeSecretKey) {
  throw new Error("STRIPE_SECRET_KEY is required. Use a Stripe test key, for example sk_test_...");
}

if (!stripeSecretKey.startsWith("sk_test_")) {
  throw new Error("Refusing to configure Stripe with a live key. Set STRIPE_SECRET_KEY to a sk_test_... key.");
}

if (!Number.isInteger(standardAmountCents) || standardAmountCents <= 0) {
  throw new Error("STRIPE_STANDARD_RESERVATION_DEPOSIT_AMOUNT_CENTS must be a positive integer.");
}

if (!Number.isInteger(largePartyAmountCents) || largePartyAmountCents <= 0) {
  throw new Error("STRIPE_LARGE_PARTY_RESERVATION_DEPOSIT_AMOUNT_CENTS must be a positive integer.");
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

async function createPaymentLink(kind: "standard" | "large_party", amountCents: number) {
  const label = kind === "standard" ? "standard reservation deposit" : "large-party reservation deposit";
  const params = new URLSearchParams({
    "line_items[0][price_data][currency]": currency,
    "line_items[0][price_data][unit_amount]": String(amountCents),
    "line_items[0][price_data][product_data][name]": `${companyName} ${label}`,
    "line_items[0][price_data][product_data][description]": "Test-mode reservation deposit collected after a phone reservation.",
    "line_items[0][quantity]": "1",
    "metadata[source]": "ycagentphone",
    "metadata[purpose]": kind,
    "payment_intent_data[metadata][source]": "ycagentphone",
    "payment_intent_data[metadata][purpose]": kind
  });

  const paymentLink = await stripePost("payment_links", params);
  const paymentLinkUrl = typeof paymentLink.url === "string" ? paymentLink.url : undefined;
  if (!paymentLinkUrl) {
    throw new Error(`Stripe did not return a ${kind} payment link URL.`);
  }

  return paymentLinkUrl;
}

const standardPaymentLinkUrl = await createPaymentLink("standard", standardAmountCents);
const largePartyPaymentLinkUrl = await createPaymentLink("large_party", largePartyAmountCents);

if (fs.existsSync(envPath)) {
  let env = fs.readFileSync(envPath, "utf8");

  const upsert = (key: string, value: string) => {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    if (pattern.test(env)) {
      env = env.replace(pattern, line);
    } else {
      env += `\n${line}\n`;
    }
  };

  upsert("STRIPE_STANDARD_RESERVATION_DEPOSIT_AMOUNT_CENTS", String(standardAmountCents));
  upsert("STRIPE_LARGE_PARTY_RESERVATION_DEPOSIT_AMOUNT_CENTS", String(largePartyAmountCents));
  upsert("STRIPE_STANDARD_RESERVATION_PAYMENT_LINK_URL", standardPaymentLinkUrl);
  upsert("STRIPE_LARGE_PARTY_RESERVATION_PAYMENT_LINK_URL", largePartyPaymentLinkUrl);

  if (!/^STRIPE_RESERVATION_PAYMENT_LINK_URL=/m.test(env)) {
    upsert("STRIPE_RESERVATION_PAYMENT_LINK_URL", standardPaymentLinkUrl);
  }

  fs.writeFileSync(envPath, env);
}

console.log("Stripe test reservation deposit payment links configured.");
console.log(`Standard amount: ${(standardAmountCents / 100).toFixed(2)} ${currency.toUpperCase()}`);
console.log(`Standard payment link: ${standardPaymentLinkUrl}`);
console.log(`Large-party amount: ${(largePartyAmountCents / 100).toFixed(2)} ${currency.toUpperCase()}`);
console.log(`Large-party payment link: ${largePartyPaymentLinkUrl}`);
if (fs.existsSync(envPath)) {
  console.log("Updated Stripe reservation payment link settings in .env.");
}
