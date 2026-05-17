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

  it("returns ndjson for streaming requests", async () => {
    const app = createApp(async () => "The answer.");

    const response = await postSigned(app, "/webhooks/agentphone?stream=1", { transcript: "Hello" }).expect(200);

    expect(response.headers["content-type"]).toContain("application/x-ndjson");
    expect(response.text).toContain('"interim":true');
    expect(response.text).toContain('"text":"The answer."');
  });
});
