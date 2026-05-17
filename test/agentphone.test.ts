import crypto from "node:crypto";
import { describe, expect, it } from "bun:test";
import {
  extractCallTurn,
  extractPostCallWebhook,
  formatAgentPhoneResponse,
  sendAgentPhoneMessage,
  verifyAgentPhoneSignature
} from "../src/agentphone.js";

describe("extractCallTurn", () => {
  it("extracts a simple transcript payload", () => {
    expect(
      extractCallTurn({
        callId: "call_123",
        from: "+15551234567",
        transcript: "What do you cost?"
      })
    ).toMatchObject({
      callId: "call_123",
      caller: "+15551234567",
      transcript: "What do you cost?"
    });
  });

  it("extracts transcript text from messages", () => {
    expect(
      extractCallTurn({
        call: { id: "call_123" },
        messages: [
          { role: "caller", content: "Hi." },
          { role: "agent", content: "How can I help?" },
          { role: "caller", content: "Do you integrate with Salesforce?" }
        ]
      }).transcript
    ).toContain("caller: Do you integrate with Salesforce?");
  });

  it("extracts transcript text from AgentPhone recentHistory", () => {
    expect(
      extractCallTurn({
        event: "agent.message",
        channel: "voice",
        recentHistory: [
          { direction: "inbound", content: "What do you cost?" },
          { direction: "outbound", content: "Let me check that." }
        ]
      }).transcript
    ).toContain("caller: What do you cost?");
  });

  it("extracts inbound SMS message payloads as text turns", () => {
    expect(
      extractCallTurn({
        event: "message.received",
        data: {
          channel: "sms",
          messageId: "msg_123",
          fromNumber: "+15551234567",
          body: "Can we move the reservation to 7:30?"
        }
      })
    ).toMatchObject({
      callId: "msg_123",
      caller: "+15551234567",
      channel: "text",
      transcript: "Can we move the reservation to 7:30?"
    });
  });

  it("marks payloads without transcript text as call starts", () => {
    expect(
      extractCallTurn({
        call: { id: "call_123", from: "+15551234567" },
        event: "call.started"
      })
    ).toMatchObject({
      callId: "call_123",
      caller: "+15551234567",
      isCallStart: true
    });
  });

  it("rejects payloads without transcript or call context", () => {
    expect(() => extractCallTurn({ event: "agent.message" })).toThrow("No caller transcript");
  });
});

describe("extractPostCallWebhook", () => {
  it("extracts the full transcript and caller from call-ended payloads", () => {
    expect(
      extractPostCallWebhook({
        event: "agent.call_ended",
        channel: "voice",
        data: {
          callId: "call_123",
          from: "+15551234567",
          numberId: "num_123",
          transcript: [
            { role: "caller", content: "Can I book a table for four Friday at 7?" },
            { role: "agent", content: "I can note that request." },
            { role: "caller", content: "It is for a birthday, and we need a window table." }
          ]
        }
      })
    ).toMatchObject({
      callId: "call_123",
      caller: "+15551234567",
      numberId: "num_123",
      transcript:
        "caller: Can I book a table for four Friday at 7?\nagent: I can note that request.\ncaller: It is for a birthday, and we need a window table.",
      turns: [
        { role: "caller", content: "Can I book a table for four Friday at 7?" },
        { role: "agent", content: "I can note that request." },
        { role: "caller", content: "It is for a birthday, and we need a window table." }
      ]
    });
  });

  it("rejects call-ended payloads without a transcript", () => {
    expect(() => extractPostCallWebhook({ event: "agent.call_ended", channel: "voice", data: {} })).toThrow(
      "No post-call transcript"
    );
  });
});

describe("verifyAgentPhoneSignature", () => {
  it("passes when no secret is configured", () => {
    expect(verifyAgentPhoneSignature(Buffer.from("{}"), undefined, undefined)).toBe(true);
  });

  it("verifies sha256 hmac signatures", () => {
    const raw = Buffer.from('{"transcript":"hello"}');
    const secret = "secret";
    const signature = crypto.createHmac("sha256", secret).update(raw).digest("hex");

    expect(verifyAgentPhoneSignature(raw, `sha256=${signature}`, secret)).toBe(true);
    expect(verifyAgentPhoneSignature(raw, "bad", secret)).toBe(false);
  });

  it("verifies timestamped webhook signatures", () => {
    const raw = Buffer.from('{"transcript":"hello"}');
    const secret = "secret";
    const timestamp = "1767150000";
    const signature = crypto.createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");

    expect(verifyAgentPhoneSignature(raw, `sha256=${signature}`, secret, timestamp)).toBe(true);
    expect(verifyAgentPhoneSignature(raw, "bad", secret, timestamp)).toBe(false);
  });
});

describe("formatAgentPhoneResponse", () => {
  it("returns redundant answer keys for easier adapter changes", () => {
    expect(formatAgentPhoneResponse("Hello")).toEqual({
      response: "Hello",
      text: "Hello",
      message: "Hello"
    });
  });

  it("includes AgentPhone hangup controls when requested", () => {
    expect(formatAgentPhoneResponse({ text: "Thanks for calling. Goodbye.", hangup: true })).toEqual({
      response: "Thanks for calling. Goodbye.",
      text: "Thanks for calling. Goodbye.",
      message: "Thanks for calling. Goodbye.",
      hangup: true,
      action: "hangup"
    });
  });
});

describe("sendAgentPhoneMessage", () => {
  it("posts outbound messages to AgentPhone", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ id: "msg_123" }), { status: 200 });
    };

    await sendAgentPhoneMessage({
      apiKey: "key",
      agentId: "agent_123",
      baseUrl: "https://api.agentphone.ai/",
      toNumber: "+15551234567",
      numberId: "num_123",
      body: "Thanks for calling.",
      fetchFn
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://api.agentphone.ai/v1/messages");
    expect(requests[0].init.method).toBe("POST");
    expect(requests[0].init.headers).toMatchObject({
      authorization: "Bearer key",
      "content-type": "application/json"
    });
    expect(JSON.parse(String(requests[0].init.body))).toEqual({
      agent_id: "agent_123",
      to_number: "+15551234567",
      number_id: "num_123",
      body: "Thanks for calling."
    });
  });
});
