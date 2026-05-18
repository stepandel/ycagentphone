import express, { type Request } from "express";
import { config } from "./config.js";
import { renderAdminPage } from "./admin-page.js";
import { answerCaller, type AnswerResult, type AnswerService } from "./agent.js";
import {
  extractCallTurn,
  extractPostCallWebhook,
  formatAgentPhoneResponse,
  formatAgentPhoneStreamingResponse,
  sendAgentPhoneMessage,
  verifyAgentPhoneSignature
} from "./agentphone.js";
import { createPostCallService, type PostCallService } from "./post-call.js";
import { recordReservationTextFollowUp } from "./reservation-log.js";
import { warmKnowledgebase } from "./memory.js";
import {
  listDiningTables,
  listReservations,
  openReservationDatabase,
  parseReservationRequestText,
  seedDiningTables
} from "./reservation-store.js";
import { extractReservationUpdatesFromText } from "./reservation-text.js";
import { isReservationQuery } from "./skills/reservation-taking.js";
import { initLangfuseTracing, shutdownLangfuseTracing } from "./tracing.js";

type RawBodyRequest = Request & {
  rawBody?: Buffer;
};

type TextReplySender = (options: { toNumber: string; body: string; numberId?: string }) => Promise<unknown>;

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

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function textFromTranscriptMessages(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const text = value
    .map((message) => {
      const item = asRecord(message);
      const content = item.content ?? item.text ?? item.transcript ?? item.message ?? item.body;
      return typeof content === "string" ? content.trim() : "";
    })
    .filter(Boolean)
    .join("\n");
  return text || undefined;
}

function reservationCheckTextCandidates(turn: ReturnType<typeof extractCallTurn>): string[] {
  const raw = asRecord(turn.raw);
  const data = asRecord(raw.data);
  const call = asRecord(raw.call);
  const conversation = asRecord(raw.conversation);
  return [
    turn.transcript,
    textFromTranscriptMessages(raw.recentHistory),
    textFromTranscriptMessages(raw.messages),
    textFromTranscriptMessages(data.messages),
    textFromTranscriptMessages(conversation.messages),
    typeof raw.transcript === "string" ? raw.transcript : undefined,
    typeof data.transcript === "string" ? data.transcript : undefined,
    typeof call.transcript === "string" ? call.transcript : undefined,
    typeof conversation.transcript === "string" ? conversation.transcript : undefined
  ].filter((text): text is string => Boolean(text?.trim()));
}

function needsReservationAvailabilityCheck(turn: ReturnType<typeof extractCallTurn>): boolean {
  if (turn.isCallStart) return false;
  return reservationCheckTextCandidates(turn).some((text) => {
    if (!isReservationQuery(text)) return false;
    const parsed = parseReservationRequestText(text);
    return Boolean(parsed.partySize && parsed.startsAt);
  });
}

function isTextFollowUp(req: Request, turn: ReturnType<typeof extractCallTurn>): boolean {
  if (turn.isCallStart || !turn.caller || !turn.transcript?.trim()) return false;
  const channel = bodyChannel(req.body);
  return turn.channel === "text" || channel === "sms" || channel === "text" || channel === "message";
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

async function answerAndSendTextReply(
  req: Request,
  turn: ReturnType<typeof extractCallTurn>,
  answerService: AnswerService,
  textReplySender: TextReplySender
): Promise<void> {
  try {
    const answer = await answerService(turn);
    await recordTextFollowUp(req, turn);
    const text = answerText(answer).trim();
    if (!text || !turn.caller) return;
    await textReplySender({
      toNumber: turn.caller,
      body: text,
      numberId: turn.numberId
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown SMS reply error.";
    console.error(`AgentPhone SMS reply failed: ${message}`);
  }
}

export function createApp(
  answerService: AnswerService = answerCaller,
  postCallService: PostCallService = createPostCallService(),
  textReplySender: TextReplySender = (options) =>
    sendAgentPhoneMessage({
      ...options,
      apiKey: config.AGENTPHONE_API_KEY,
      agentId: config.AGENTPHONE_AGENT_ID,
      baseUrl: config.AGENTPHONE_BASE_URL
    })
) {
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

  app.get("/admin", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(
      renderAdminPage({
        restaurantName: config.COMPANY_NAME,
        timeZone: config.RESTAURANT_TIME_ZONE,
        phone: config.RESTAURANT_PHONE
      })
    );
  });

  app.get("/admin/api/reservations", (_req, res) => {
    const db = openReservationDatabase();
    try {
      seedDiningTables(db);
      const reservations = listReservations(db);
      const tables = listDiningTables(db);
      res.json({ reservations, tables, timeZone: config.RESTAURANT_TIME_ZONE });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load reservations.";
      console.error(message);
      res.status(500).json({ error: message });
    } finally {
      db.close();
    }
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

    if (isTextFollowUp(req, turn)) {
      res.status(202).json({ ok: true, queued: true });
      void answerAndSendTextReply(req, turn, answerService, textReplySender);
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
      if (needsReservationAvailabilityCheck(turn)) {
        res.write(`${JSON.stringify({ text: config.RESTAURANT_PROCESSING_MESSAGE, interim: true })}\n`);
      }
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
      res.send(
        needsReservationAvailabilityCheck(turn)
          ? formatAgentPhoneStreamingResponse(config.RESTAURANT_PROCESSING_MESSAGE, answer)
          : `${JSON.stringify(answerChunk(answer))}\n`
      );
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
  void warmKnowledgebase().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown Moss warmup error.";
    console.error(`Moss warmup failed: ${message}`);
  });
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
