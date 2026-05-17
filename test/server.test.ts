import request from "supertest";
import { describe, expect, it } from "bun:test";
import { createApp } from "../src/server.js";

describe("server", () => {
  it("reports health", async () => {
    const app = createApp(async () => "ok");

    await request(app).get("/health").expect(200, { ok: true });
  });

  it("answers webhook turns", async () => {
    const app = createApp(async ({ transcript }) => `Echo: ${transcript}`);

    const response = await request(app)
      .post("/webhooks/agentphone")
      .send({ transcript: "What do you cost?" })
      .expect(200);

    expect(response.body.response).toBe("Echo: What do you cost?");
  });

  it("returns ndjson for streaming requests", async () => {
    const app = createApp(async () => "The answer.");

    const response = await request(app)
      .post("/webhooks/agentphone?stream=1")
      .send({ transcript: "Hello" })
      .expect(200);

    expect(response.headers["content-type"]).toContain("application/x-ndjson");
    expect(response.text).toContain('"type":"done"');
  });
});
