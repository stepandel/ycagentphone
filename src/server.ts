import express, { type Request } from "express";
import { config } from "./config.js";
import { answerCaller, type AnswerResult, type AnswerService } from "./agent.js";
import {
  extractCallTurn,
  extractPostCallWebhook,
  formatAgentPhoneResponse,
  formatAgentPhoneStreamingResponse,
  verifyAgentPhoneSignature
} from "./agentphone.js";
import { createPostCallService, type PostCallService } from "./post-call.js";
import { recordReservationTextFollowUp } from "./reservation-log.js";
import { initLangfuseTracing, shutdownLangfuseTracing } from "./tracing.js";

type RawBodyRequest = Request & {
  rawBody?: Buffer;
};

function bodyChannel(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const channel = (body as Record<string, unknown>).channel;
  return typeof channel === "string" ? channel.toLowerCase() : undefined;
}

function answerText(answer: AnswerResult): string {
  return typeof answer === "string" ? answer : answer.text;
}

function answerChunk(answer: AnswerResult) {
  return typeof answer === "string"
    ? { text: answer }
    : {
        text: answer.text,
        ...(answer.hangup ? { hangup: true, action: "hangup" } : {})
      };
}

function isTextFollowUp(req: Request, turn: ReturnType<typeof extractCallTurn>): boolean {
  if (turn.isCallStart || !turn.caller || !turn.transcript?.trim()) return false;
  const channel = bodyChannel(req.body);
  return channel === "sms" || channel === "text" || channel === "message";
}

async function recordTextFollowUp(req: Request, turn: ReturnType<typeof extractCallTurn>): Promise<void> {
  if (!isTextFollowUp(req, turn)) return;
  try {
    await recordReservationTextFollowUp({
      caller: turn.caller,
      transcript: turn.transcript
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown reservation log error.";
    console.error(`Reservation text follow-up log failed: ${message}`);
  }
}

export function createApp(answerService: AnswerService = answerCaller, postCallService: PostCallService = createPostCallService()) {
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
    const timestamp = req.headers["x-webhook-timestamp"];

    if (!verifyAgentPhoneSignature(req.rawBody ?? Buffer.from(""), signature, config.AGENTPHONE_WEBHOOK_SECRET, timestamp)) {
      res.status(401).json({ error: "Invalid webhook signature." });
      return;
    }

    if (bodyChannel(req.body) === "voice" && typeof req.body?.event === "string" && req.body.event === "agent.call_ended") {
      try {
        const postCall = extractPostCallWebhook(req.body);
        const result = await postCallService(postCall);
        res.json({ ok: true, postCall: result });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown post-call webhook error.";
        console.error(message);
        res.status(400).json({ error: message });
      }
      return;
    }

    let turn: ReturnType<typeof extractCallTurn>;
    try {
      turn = extractCallTurn(req.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown webhook error.";
      console.error(message);
      res.status(400).json({ error: message });
      return;
    }

    const shouldStream =
      !turn.isCallStart &&
      (req.query.stream === "1" ||
        req.headers.accept?.includes("application/x-ndjson") ||
        bodyChannel(req.body) === "voice");

    if (shouldStream) {
      res.setHeader("Content-Type", "application/x-ndjson");
      res.write(`${JSON.stringify({ text: config.RESTAURANT_PROCESSING_MESSAGE, interim: true })}\n`);
      try {
        const answer = await answerService(turn);
        await recordTextFollowUp(req, turn);
        res.write(`${JSON.stringify(answerChunk(answer))}\n`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown webhook error.";
        console.error(message);
        res.write(`${JSON.stringify({ text: "I'm sorry, I had trouble checking that. Please try again in a moment." })}\n`);
      }
      res.end();
      return;
    }

    let answer: AnswerResult = "";
    try {
      answer = await answerService(turn);
      await recordTextFollowUp(req, turn);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown webhook error.";
      console.error(message);
      res.status(400).json({ error: message });
      return;
    }

    if (req.query.stream === "1" || req.headers.accept?.includes("application/x-ndjson")) {
      res.setHeader("Content-Type", "application/x-ndjson");
      res.send(formatAgentPhoneStreamingResponse(config.RESTAURANT_PROCESSING_MESSAGE, answer));
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
    res.json({ answer: answerText(answer) });
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  initLangfuseTracing();
  const app = createApp();
  const server = app.listen(config.PORT, config.HOST, () => {
    console.log(`ycagentphone listening on http://${config.HOST}:${config.PORT}`);
  });

  const shutdown = async () => {
    server.close();
    await shutdownLangfuseTracing();
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
