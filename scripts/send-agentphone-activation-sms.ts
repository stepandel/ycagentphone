import "dotenv/config";
import { sendAgentPhoneMessage } from "../src/agentphone.js";

const toNumber = process.argv[2];
const companyName = process.env.COMPANY_NAME || "Sotto Mare";

if (!toNumber) {
  throw new Error("Usage: bun scripts/send-agentphone-activation-sms.ts +15551234567");
}

const body = `${companyName}: You are opted in to receive reservation and call follow-up texts from us. Reply STOP to unsubscribe.`;

await sendAgentPhoneMessage({
  apiKey: process.env.AGENTPHONE_API_KEY,
  agentId: process.env.AGENTPHONE_AGENT_ID,
  baseUrl: process.env.AGENTPHONE_BASE_URL,
  toNumber,
  body
});

console.log(`Sent AgentPhone activation SMS to ${toNumber}.`);
