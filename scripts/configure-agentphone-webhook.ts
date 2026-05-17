import "dotenv/config";
import fs from "node:fs";
import { buildSystemPrompt } from "../src/prompt.js";

const agentPhoneApiKey = process.env.AGENTPHONE_API_KEY;
const agentPhoneBaseUrl = process.env.AGENTPHONE_BASE_URL || "https://api.agentphone.ai";
const agentId = process.env.AGENTPHONE_AGENT_ID;
const webhookBaseUrl = process.env.AGENTPHONE_WEBHOOK_BASE_URL;
const companyName = process.env.COMPANY_NAME || "Your Restaurant";
const publicContactEmail = process.env.PUBLIC_CONTACT_EMAIL || "events@example.com";
const restaurantGreeting =
  process.env.RESTAURANT_GREETING ||
  "Good evening, and thank you for calling. This is the restaurant's virtual host. How may I help you today?";
const envPath = ".env";

if (!agentPhoneApiKey) {
  throw new Error("AGENTPHONE_API_KEY is required.");
}

if (!agentId) {
  throw new Error("AGENTPHONE_AGENT_ID is required.");
}

if (!webhookBaseUrl) {
  throw new Error("AGENTPHONE_WEBHOOK_BASE_URL is required.");
}

const webhookUrl = `${webhookBaseUrl.replace(/\/+$/, "")}/webhooks/agentphone`;
const agentResponse = await fetch(`${agentPhoneBaseUrl}/v1/agents/${agentId}`, {
  method: "PATCH",
  headers: {
    authorization: `Bearer ${agentPhoneApiKey}`,
    "content-type": "application/json"
  },
  body: JSON.stringify({
    voiceMode: "webhook",
    beginMessage: restaurantGreeting,
    systemPrompt: buildSystemPrompt(companyName, publicContactEmail)
  })
});

const agentResponseText = await agentResponse.text();

if (!agentResponse.ok) {
  console.error(`Failed to update AgentPhone agent: ${agentResponse.status} ${agentResponse.statusText}`);
  console.error(agentResponseText);
  process.exit(1);
}

const response = await fetch(`${agentPhoneBaseUrl}/v1/agents/${agentId}/webhook`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${agentPhoneApiKey}`,
    "content-type": "application/json"
  },
  body: JSON.stringify({
    url: webhookUrl,
    timeout: 120
  })
});

const responseText = await response.text();

if (!response.ok) {
  console.error(`${response.status} ${response.statusText}`);
  console.error(responseText);
  process.exit(1);
}

const data = JSON.parse(responseText) as {
  id: string;
  url: string;
  secret?: string;
  status: string;
  timeout: number;
};

if (data.secret && fs.existsSync(envPath)) {
  let env = fs.readFileSync(envPath, "utf8");
  if (/^AGENTPHONE_WEBHOOK_SECRET=/m.test(env)) {
    env = env.replace(/^AGENTPHONE_WEBHOOK_SECRET=.*$/m, `AGENTPHONE_WEBHOOK_SECRET=${data.secret}`);
  } else {
    env += `\nAGENTPHONE_WEBHOOK_SECRET=${data.secret}\n`;
  }
  fs.writeFileSync(envPath, env);
}

console.log("AgentPhone agent configured for webhook voice mode.");
console.log(`Begin message: ${restaurantGreeting}`);
console.log(`AgentPhone webhook configured: ${data.url}`);
console.log(`Status: ${data.status}`);
console.log(`Timeout: ${data.timeout}`);
if (data.secret) {
  console.log("Updated AGENTPHONE_WEBHOOK_SECRET in .env.");
  console.log("Restart the webhook server before running signed webhook tests or taking calls.");
}
