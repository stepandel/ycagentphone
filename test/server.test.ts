import crypto from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "bun:test";
import { createApp } from "../src/server.js";

function postSigned(app: ReturnType<typeof createApp>, path: string, body: unknown) {
  const raw = JSON.stringify(body);
  const req = request(app).post(path).set("content-type", "application/json");
  const secret = process.env.AGENTPHONE_WEBHOOK_SECRET;

  if (!secret) return req.send(raw);

  const timestamp = "1767150000";
  const signature = crypto.createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");

  return req.set("x-webhook-timestamp", timestamp).set("x-webhook-signature", `sha256=${signature}`).send(raw);
}

describe("server", () => {
  it("reports health", async () => {
    const app = createApp(async () => "ok");

    await request(app).get("/health").expect(200, { ok: true });
  });

  it("answers webhook turns", async () => {
    const app = createApp(async ({ transcript }) => `Echo: ${transcript}`);

    const response = await postSigned(app, "/webhooks/agentphone", { transcript: "What do you cost?" }).expect(200);

    expect(response.body.response).toBe("Echo: What do you cost?");
  });

  it("queues inbound SMS replies and sends the answer as an outbound text", async () => {
    const turns: unknown[] = [];
    const sent: Array<{ toNumber: string; body: string; numberId?: string }> = [];
    let resolveReplySent!: () => void;
    const replySent = new Promise<void>((resolve) => {
      resolveReplySent = resolve;
    });
    const app = createApp(async (turn) => {
      turns.push(turn);
      return `Text reply: ${turn.transcript}`;
    }, undefined, async (message) => {
      sent.push(message);
      resolveReplySent();
    });

    const response = await postSigned(app, "/webhooks/agentphone", {
      event: "message.received",
      data: {
        channel: "sms",
        numberId: "num_123",
        fromNumber: "+15551234567",
        body: "Can we move the reservation to 7:30?"
      }
    }).expect(202);

    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.body).toEqual({ ok: true, queued: true });
    await replySent;
    expect(turns[0]).toMatchObject({
      caller: "+15551234567",
      numberId: "num_123",
      channel: "text",
      transcript: "Can we move the reservation to 7:30?"
    });
    expect(sent).toEqual([
      {
        toNumber: "+15551234567",
        numberId: "num_123",
        body: "Text reply: Can we move the reservation to 7:30?"
      }
    ]);
  });

  it("passes call-start webhooks to the answer service", async () => {
    const app = createApp(async ({ isCallStart }) => (isCallStart ? "Good evening, and thank you for calling." : "Later."));

    const response = await postSigned(app, "/webhooks/agentphone", { event: "call.started" }).expect(200);

    expect(response.body.response).toBe("Good evening, and thank you for calling.");
  });

  it("returns ndjson for streaming requests", async () => {
    const app = createApp(async () => "The answer.");

    const response = await postSigned(app, "/webhooks/agentphone?stream=1", { transcript: "Hello" }).expect(200);

    expect(response.headers["content-type"]).toContain("application/x-ndjson");
    expect(response.text).not.toContain('"interim":true');
    expect(response.text).toContain('"text":"The answer."');
  });

  it("streams an interim response for reservation availability checks", async () => {
    const app = createApp(async () => "Yes, we have room at 7.");

    const response = await postSigned(app, "/webhooks/agentphone?stream=1", {
      transcript: "Can I book a table for 4 next Friday at 7pm?"
    }).expect(200);

    const lines = response.text.trim().split("\n").map((line) => JSON.parse(line));
    expect(response.headers["content-type"]).toContain("application/x-ndjson");
    expect(lines).toEqual([
      { text: "Of course. Let me check that for you.", interim: true },
      { text: "Yes, we have room at 7." }
    ]);
  });

  it("streams an interim response when reservation details are in recent history", async () => {
    const app = createApp(async () => "Yes, we have room at 7.");

    const response = await postSigned(app, "/webhooks/agentphone", {
      channel: "voice",
      event: "agent.message",
      transcript: "Yes, that works.",
      recentHistory: [
        { role: "caller", content: "Can I book a table for 4 next Friday?" },
        { role: "agent", content: "What time would you like?" },
        { role: "caller", content: "7pm." }
      ]
    }).expect(200);

    const lines = response.text.trim().split("\n").map((line) => JSON.parse(line));
    expect(response.headers["content-type"]).toContain("application/x-ndjson");
    expect(lines).toEqual([
      { text: "Of course. Let me check that for you.", interim: true },
      { text: "Yes, we have room at 7." }
    ]);
  });

  it("passes hangup controls through normal webhook responses", async () => {
    const app = createApp(async () => ({ text: "Thanks for calling. Goodbye.", hangup: true }));

    const response = await postSigned(app, "/webhooks/agentphone", { transcript: "Thanks, bye." }).expect(200);

    expect(response.body).toMatchObject({
      text: "Thanks for calling. Goodbye.",
      hangup: true,
      action: "hangup"
    });
  });

  it("streams non-reservation voice answers without an interim response", async () => {
    let answerStarted = false;
    const app = createApp(
      () =>
        new Promise((resolve) => {
          answerStarted = true;
          setTimeout(() => resolve("The answer."), 25);
        })
    );

    const response = await postSigned(app, "/webhooks/agentphone", {
      channel: "voice",
      event: "agent.message",
      transcript: "Do you have oysters?"
    }).expect(200);

    const lines = response.text.trim().split("\n").map((line) => JSON.parse(line));
    expect(answerStarted).toBe(true);
    expect(response.headers["content-type"]).toContain("application/x-ndjson");
    expect(lines).toEqual([{ text: "The answer." }]);
  });

  it("passes hangup controls through voice streaming responses", async () => {
    const app = createApp(async () => ({ text: "Thanks for calling. Goodbye.", hangup: true }));

    const response = await postSigned(app, "/webhooks/agentphone", {
      channel: "voice",
      event: "agent.message",
      transcript: "That is all, thanks."
    }).expect(200);

    const lines = response.text.trim().split("\n").map((line) => JSON.parse(line));
    expect(lines).toEqual([{
      text: "Thanks for calling. Goodbye.",
      hangup: true,
      action: "hangup"
    }]);
  });

  it("handles post-call webhooks and sends reservation follow-up details", async () => {
    const postCalls: unknown[] = [];
    const app = createApp(
      async () => "live answer",
      async (call) => {
        postCalls.push(call);
        return {
          sent: true,
          message:
            "Thanks for calling Your Restaurant. We noted your reservation details: Party size: 4; Day/time: Friday at 7 PM; Special notes: birthday."
        };
      }
    );

    const response = await postSigned(app, "/webhooks/agentphone", {
      event: "agent.call_ended",
      channel: "voice",
      data: {
        callId: "call_123",
        from: "+15551234567",
        transcript: [
          { role: "caller", content: "Can I book a table for four Friday at 7?" },
          { role: "agent", content: "I can note that request." },
          { role: "caller", content: "Birthday dinner, please." }
        ]
      }
    }).expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      postCall: { sent: true }
    });
    expect(postCalls).toHaveLength(1);
    expect(postCalls[0]).toMatchObject({
      callId: "call_123",
      caller: "+15551234567",
      transcript:
        "caller: Can I book a table for four Friday at 7?\nagent: I can note that request.\ncaller: Birthday dinner, please."
    });
  });
});
