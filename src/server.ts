import express, { type Request } from "express";
import { config } from "./config.js";
import { answerCaller, type AnswerService } from "./agent.js";
import {
  extractCallTurn,
  formatAgentPhoneNdjson,
  formatAgentPhoneResponse,
  verifyAgentPhoneSignature
} from "./agentphone.js";

type RawBodyRequest = Request & {
  rawBody?: Buffer;
};

export function createApp(answerService: AnswerService = answerCaller) {
  const app = express();

  app.use(
    express.json({
      verify: (req: RawBodyRequest, _res, buffer) => {
        req.rawBody = Buffer.from(buffer);
      }
    })
  );

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/webhooks/agentphone", async (req: RawBodyRequest, res) => {
    const signature =
      req.headers["x-agentphone-signature"] ??
      req.headers["x-webhook-signature"] ??
      req.headers["x-signature"];

    if (!verifyAgentPhoneSignature(req.rawBody ?? Buffer.from(""), signature, config.AGENTPHONE_WEBHOOK_SECRET)) {
      res.status(401).json({ error: "Invalid webhook signature." });
      return;
    }

    let answer = "";
    try {
      const turn = extractCallTurn(req.body);
      answer = await answerService(turn);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown webhook error.";
      console.error(message);
      res.status(400).json({ error: message });
      return;
    }

    if (req.query.stream === "1" || req.headers.accept?.includes("application/x-ndjson")) {
      res.setHeader("Content-Type", "application/x-ndjson");
      res.send(formatAgentPhoneNdjson(answer));
      return;
    }

    res.json(formatAgentPhoneResponse(answer));
  });

  app.post("/test/turn", async (req, res) => {
    const transcript = typeof req.body?.transcript === "string" ? req.body.transcript : "";
    if (!transcript.trim()) {
      res.status(400).json({ error: "Send { \"transcript\": \"...\" }." });
      return;
    }

    const answer = await answerService({ transcript });
    res.json({ answer });
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  app.listen(config.PORT, () => {
    console.log(`ycagentphone listening on http://localhost:${config.PORT}`);
  });
}
