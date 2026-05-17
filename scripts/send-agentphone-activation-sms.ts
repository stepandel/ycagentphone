import "dotenv/config";
import { sendAgentPhoneMessage } from "../src/agentphone.js";

const toNumber = process.argv[2];
const fromNumber = process.argv[3] || process.env.AGENTPHONE_FROM_NUMBER;
const companyName = process.env.COMPANY_NAME || "Sotto Mare";
const agentPhoneBaseUrl = process.env.AGENTPHONE_BASE_URL || "https://api.agentphone.ai";

if (!toNumber) {
  throw new Error("Usage: bun scripts/send-agentphone-activation-sms.ts +15551234567 [+15557654321]");
}

const body = `${companyName}: You are opted in to receive reservation and call follow-up texts from us. Reply STOP to unsubscribe.`;

async function findNumberId(phoneNumber: string): Promise<string> {
  if (!process.env.AGENTPHONE_API_KEY) {
    throw new Error("AGENTPHONE_API_KEY is required to resolve the sender number.");
  }

  const url = `${agentPhoneBaseUrl.replace(/\/+$/, "")}/v1/numbers?limit=100`;
  console.log("AgentPhone API request", {
    method: "GET",
    url,
    query: { limit: 100 }
  });

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${process.env.AGENTPHONE_API_KEY}`
    }
  });
  const responseText = await response.text();
  console.log("AgentPhone API response", {
    status: response.status,
    statusText: response.statusText,
    body: responseText
  });

  if (!response.ok) {
    throw new Error(`AgentPhone number lookup failed: ${response.status} ${response.statusText} ${responseText}`);
  }

  const data = JSON.parse(responseText) as {
    data?: Array<{ id: string; phoneNumber: string }>;
  };
  const number = data.data?.find((item) => item.phoneNumber === phoneNumber);

  if (!number) {
    throw new Error(`AgentPhone number ${phoneNumber} was not found in this account.`);
  }

  return number.id;
}

const numberId = fromNumber ? await findNumberId(fromNumber) : undefined;

await sendAgentPhoneMessage({
  apiKey: process.env.AGENTPHONE_API_KEY,
  agentId: process.env.AGENTPHONE_AGENT_ID,
  baseUrl: agentPhoneBaseUrl,
  toNumber,
  numberId,
  body,
  logApi: true
});

console.log(`Sent AgentPhone activation SMS to ${toNumber}${fromNumber ? ` from ${fromNumber}` : ""}.`);
