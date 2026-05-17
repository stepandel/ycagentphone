import "dotenv/config";
import crypto from "node:crypto";

const transcript = process.argv.slice(2).join(" ").trim() || "What do you cost?";
const url = process.env.WEBHOOK_TEST_URL || `http://localhost:${process.env.PORT || "3000"}/webhooks/agentphone`;
const secret = process.env.AGENTPHONE_WEBHOOK_SECRET;

const payload = {
  callId: "test-call-1",
  from: "+15551234567",
  transcript
};

const body = JSON.stringify(payload);
const headers: Record<string, string> = {
  "content-type": "application/json"
};

if (secret) {
  const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");
  headers["x-agentphone-signature"] = `sha256=${signature}`;
}

const response = await fetch(url, {
  method: "POST",
  headers,
  body
});

const text = await response.text();
console.log(`${response.status} ${response.statusText}`);
console.log(text);

if (!response.ok) {
  process.exit(1);
}
