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
import type { ReservationDetails } from "./post-call.js";
import { recordReservationTextFollowUp } from "./reservation-log.js";
import { initLangfuseTracing, shutdownLangfuseTracing } from "./tracing.js";

type RawBodyRequest = Request & {
  rawBody?: Buffer;
};

function bodyChannel(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const record = body as Record<string, unknown>;
  const data = typeof record.data === "object" && record.data !== null ? (record.data as Record<string, unknown>) : {};
  const message = typeof record.message === "object" && record.message !== null ? (record.message as Record<string, unknown>) : {};
  const sms = typeof record.sms === "object" && record.sms !== null ? (record.sms as Record<string, unknown>) : {};
  const channel = record.channel ?? data.channel ?? message.channel ?? sms.channel;
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
  return turn.channel === "text" || channel === "sms" || channel === "text" || channel === "message";
}

function numberFromWord(value: string): string {
  const words: Record<string, string> = {
    one: "1",
    two: "2",
    three: "3",
    four: "4",
    five: "5",
    six: "6",
    seven: "7",
    eight: "8",
    nine: "9",
    ten: "10",
    eleven: "11",
    twelve: "12"
  };
  return words[value.toLowerCase()] ?? value;
}

function extractReservationUpdatesFromText(transcript: string): Partial<ReservationDetails> | undefined {
  const text = transcript.trim();
  const updates: Partial<ReservationDetails> = {};
  const partyMatch = text.match(/\b(?:party|table|reservation)\s+(?:of|for)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i);
  const timeMatch =
    text.match(/\b(?:make it|move (?:it|us)|change (?:it|the time|my reservation)|switch (?:it|us)|can we do|could we do)\s+(?:to\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i) ??
    text.match(/\b(?:at|for)\s+(\d{1,2}:\d{2}\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm))\b/i);
  const dayMatch = text.match(
    /\b(today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan(?:uary)?\.?\s+\d{1,2}|feb(?:ruary)?\.?\s+\d{1,2}|mar(?:ch)?\.?\s+\d{1,2}|apr(?:il)?\.?\s+\d{1,2}|may\s+\d{1,2}|jun(?:e)?\.?\s+\d{1,2}|jul(?:y)?\.?\s+\d{1,2}|aug(?:ust)?\.?\s+\d{1,2}|sep(?:tember)?\.?\s+\d{1,2}|oct(?:ober)?\.?\s+\d{1,2}|nov(?:ember)?\.?\s+\d{1,2}|dec(?:ember)?\.?\s+\d{1,2})\b/i
  );
  const noteMatch = text.match(/\b(high chair|booster|birthday|anniversary|allerg(?:y|ies|ic)|wheelchair|accessible|window table|patio|cake|byow|corkage|gluten[- ]free|vegetarian|vegan)\b/i);

  if (partyMatch?.[1]) updates.partySize = numberFromWord(partyMatch[1]);
  if (timeMatch?.[1]) updates.time = timeMatch[1].replace(/\s+/g, " ").trim();
  if (dayMatch?.[1]) updates.day = dayMatch[1].trim();
  if (noteMatch) updates.specialNotes = text;

  return Object.keys(updates).length > 0 ? updates : undefined;
}

async function recordTextFollowUp(req: Request, turn: ReturnType<typeof extractCallTurn>): Promise<void> {
  if (!isTextFollowUp(req, turn)) return;
  try {
    await recordReservationTextFollowUp({
      caller: turn.caller,
      transcript: turn.transcript,
      reservationUpdates: extractReservationUpdatesFromText(turn.transcript ?? "")
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
        turn.channel === "voice" ||
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
