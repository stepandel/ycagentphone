import crypto from "node:crypto";

export type CallTurn = {
  callId?: string;
  caller?: string;
  transcript?: string;
  isCallStart: boolean;
  raw: unknown;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null ? (value as UnknownRecord) : {};
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function transcriptFromMessages(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined;

  const lines = messages
    .map((message) => {
      const item = asRecord(message);
      const direction = firstString(item.direction);
      const role =
        firstString(item.role, item.speaker, item.from) ??
        (direction === "inbound" ? "caller" : direction === "outbound" ? "agent" : undefined) ??
        "caller";
      const content = firstString(item.content, item.text, item.transcript, item.message);
      return content ? `${role}: ${content}` : undefined;
    })
    .filter(Boolean);

  return lines.length > 0 ? lines.join("\n") : undefined;
}

function isCallStartPayload(body: UnknownRecord): boolean {
  const event = firstString(body.event, body.type, body.status)?.toLowerCase();
  if (event?.includes("start") || event?.includes("initiated") || event?.includes("ringing")) {
    return true;
  }

  return Object.keys(asRecord(body.call)).length > 0 || Object.keys(asRecord(body.conversation)).length > 0;
}

export function extractCallTurn(payload: unknown): CallTurn {
  const body = asRecord(payload);
  const call = asRecord(body.call);
  const caller = asRecord(body.caller);
  const conversation = asRecord(body.conversation);

  const transcript =
    firstString(
      body.transcript,
      body.text,
      body.message,
      body.input,
      body.userInput,
      body.callerTranscript,
      call.transcript,
      conversation.transcript
    ) ??
    transcriptFromMessages(body.messages) ??
    transcriptFromMessages(conversation.messages) ??
    transcriptFromMessages(body.recentHistory);
  const isCallStart = !transcript && isCallStartPayload(body);

  if (!transcript && !isCallStart) {
    throw new Error("No caller transcript found in webhook payload.");
  }

  return {
    callId: firstString(body.callId, body.call_id, call.id, call.callId, conversation.id),
    caller: firstString(body.from, body.phoneNumber, caller.phoneNumber, caller.number, call.from),
    isCallStart,
    transcript,
    raw: payload
  };
}

export function verifyAgentPhoneSignature(
  rawBody: Buffer,
  signatureHeader: string | string[] | undefined,
  secret: string | undefined,
  timestampHeader?: string | string[] | undefined
): boolean {
  if (!secret) return true;
  const provided = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  if (!provided) return false;

  const timestamp = Array.isArray(timestampHeader) ? timestampHeader[0] : timestampHeader;
  const signedPayload = timestamp ? Buffer.concat([Buffer.from(`${timestamp}.`), rawBody]) : rawBody;
  const expected = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");
  const normalizedProvided = provided.replace(/^sha256=/, "").trim();

  if (timingSafeEqual(expected, normalizedProvided)) return true;

  if (timestamp) {
    const legacyExpected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    return timingSafeEqual(legacyExpected, normalizedProvided);
  }

  return false;
}

function timingSafeEqual(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(expected, "hex");
  const providedBuffer = Buffer.from(provided, "hex");
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

export function formatAgentPhoneResponse(answer: string): UnknownRecord {
  return {
    response: answer,
    text: answer,
    message: answer
  };
}

export function formatAgentPhoneNdjson(answer: string): string {
  return formatAgentPhoneStreamingResponse("Let me check that.", answer);
}

export function formatAgentPhoneStreamingResponse(interim: string, answer: string): string {
  return [
    JSON.stringify({ text: interim, interim: true }),
    JSON.stringify({ text: answer })
  ].join("\n");
}
