import crypto from "node:crypto";
import { describe, expect, it } from "bun:test";
import {
  extractCallTurn,
  formatAgentPhoneResponse,
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
});
