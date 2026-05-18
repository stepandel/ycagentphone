import crypto from "node:crypto";

export type CallTurn = {
  callId?: string;
  caller?: string;
  numberId?: string;
  channel?: "voice" | "text";
  transcript?: string;
  isCallStart: boolean;
  raw: unknown;
};

export type TranscriptTurn = {
  role: string;
  content: string;
};

export type PostCallWebhook = {
  callId?: string;
  caller?: string;
  numberId?: string;
  transcript: string;
  turns: TranscriptTurn[];
  raw: unknown;
};

export type VoiceAnswer = {
  text: string;
  hangup?: boolean;
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

function normalizeChannel(value: string | undefined): "voice" | "text" | undefined {
  const channel = value?.toLowerCase();
  if (!channel) return undefined;
  if (channel === "sms" || channel === "text" || channel === "message") return "text";
  if (channel === "voice" || channel === "call" || channel === "phone") return "voice";
  return undefined;
}

function inferChannel(body: UnknownRecord, data: UnknownRecord, message: UnknownRecord, sms: UnknownRecord): "voice" | "text" | undefined {
  const explicit = normalizeChannel(firstString(body.channel, data.channel, message.channel, sms.channel));
  if (explicit) return explicit;

  const event = firstString(body.event, body.type, data.event, data.type)?.toLowerCase();
  if (event?.startsWith("message.") || event?.includes("sms")) return "text";
  if (event === "agent.message" && (Array.isArray(body.recentHistory) || Array.isArray(data.recentHistory))) return "voice";
  return undefined;
}

function transcriptFromMessages(messages: unknown): string | undefined {
  const turns = transcriptTurnsFromMessages(messages);
  return turns.length > 0 ? turns.map((turn) => `${turn.role}: ${turn.content}`).join("\n") : undefined;
}

function combineTranscriptWithHistory(latestTranscript: string | undefined, historyTranscript: string | undefined): string | undefined {
  if (!historyTranscript) return latestTranscript;
  if (!latestTranscript) return historyTranscript;
  if (historyTranscript.includes(latestTranscript)) return historyTranscript;
  return `${historyTranscript}\ncaller: ${latestTranscript}`;
}

function firstTranscriptFromMessages(...values: unknown[]): string | undefined {
  for (const value of values) {
    const transcript = transcriptFromMessages(value);
    if (transcript) return transcript;
  }
  return undefined;
}

function transcriptTurnsFromMessages(messages: unknown): TranscriptTurn[] {
  if (!Array.isArray(messages)) return [];

  return messages
    .map((message) => {
      const item = asRecord(message);
      const direction = firstString(item.direction);
      const role =
        firstString(item.role, item.speaker, item.from) ??
        (direction === "inbound" ? "caller" : direction === "outbound" ? "agent" : undefined) ??
        "caller";
      const content = firstString(item.content, item.text, item.transcript, item.message, item.body);
      return content ? { role, content } : undefined;
    })
    .filter((turn): turn is TranscriptTurn => Boolean(turn));
}

function firstTranscriptTurns(...values: unknown[]): TranscriptTurn[] {
  for (const value of values) {
    const turns = transcriptTurnsFromMessages(value);
    if (turns.length > 0) return turns;
  }
  return [];
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
  const data = asRecord(body.data);
  const call = asRecord(body.call);
  const caller = asRecord(body.caller);
  const contact = asRecord(body.contact);
  const conversation = asRecord(body.conversation);
  const message = asRecord(body.message);
  const sms = asRecord(body.sms);

  const latestTranscript = firstString(
    body.transcript,
    body.text,
    body.message,
    body.input,
    body.userInput,
    body.callerTranscript,
    data.transcript,
    data.text,
    data.message,
    data.body,
    message.text,
    message.body,
    sms.text,
    sms.body,
    call.transcript,
    conversation.transcript
  );
  const historyTranscript = firstTranscriptFromMessages(data.messages, body.messages, conversation.messages, body.recentHistory, data.recentHistory);
  const transcript = combineTranscriptWithHistory(latestTranscript, historyTranscript);
  const isCallStart = !transcript && isCallStartPayload(body);

  if (!transcript && !isCallStart) {
    throw new Error("No caller transcript found in webhook payload.");
  }

  return {
    callId: firstString(body.callId, body.call_id, body.messageId, data.callId, data.call_id, data.messageId, call.id, call.callId, conversation.id),
    numberId: firstString(body.numberId, body.number_id, data.numberId, data.number_id, call.numberId, call.number_id),
    caller: firstString(
      body.from,
      body.fromNumber,
      body.phoneNumber,
      data.from,
      data.fromNumber,
      data.phoneNumber,
      caller.phoneNumber,
      caller.number,
      contact.phoneNumber,
      contact.number,
      message.from,
      message.fromNumber,
      sms.from,
      sms.fromNumber,
      call.from
    ),
    channel: inferChannel(body, data, message, sms),
    isCallStart,
    transcript,
    raw: payload
  };
}

function isPostCallPayload(body: UnknownRecord): boolean {
  const event = firstString(body.event, body.type)?.toLowerCase();
  return event === "agent.call_ended" || event === "call.ended" || event === "call.completed";
}

export function extractPostCallWebhook(payload: unknown): PostCallWebhook {
  const body = asRecord(payload);
  if (!isPostCallPayload(body)) {
    throw new Error("Webhook payload is not a post-call event.");
  }

  const data = asRecord(body.data);
  const call = asRecord(body.call);
  const caller = asRecord(body.caller);
  const turns = firstTranscriptTurns(data.transcript, body.transcript, call.transcript);
  const transcript =
    transcriptFromMessages(data.transcript) ??
    transcriptFromMessages(body.transcript) ??
    transcriptFromMessages(call.transcript) ??
    firstString(data.transcript, body.transcript, call.transcript);

  if (!transcript) {
    throw new Error("No post-call transcript found in webhook payload.");
  }

  return {
    callId: firstString(data.callId, data.call_id, body.callId, body.call_id, call.id, call.callId),
    caller: firstString(data.from, data.fromNumber, body.from, body.fromNumber, caller.phoneNumber, caller.number, call.from, call.fromNumber),
    numberId: firstString(data.numberId, body.numberId, call.numberId),
    transcript,
    turns,
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

function normalizeVoiceAnswer(answer: string | VoiceAnswer): VoiceAnswer {
  return typeof answer === "string" ? { text: answer } : answer;
}

export function formatAgentPhoneResponse(answer: string | VoiceAnswer): UnknownRecord {
  const voiceAnswer = normalizeVoiceAnswer(answer);
  return {
    response: voiceAnswer.text,
    text: voiceAnswer.text,
    message: voiceAnswer.text,
    ...(voiceAnswer.hangup ? { hangup: true, action: "hangup" } : {})
  };
}

export function formatAgentPhoneNdjson(answer: string): string {
  return formatAgentPhoneStreamingResponse("Let me check that.", answer);
}

export function formatAgentPhoneStreamingResponse(interim: string, answer: string | VoiceAnswer): string {
  const voiceAnswer = normalizeVoiceAnswer(answer);
  return [
    JSON.stringify({ text: interim, interim: true }),
    JSON.stringify({
      text: voiceAnswer.text,
      ...(voiceAnswer.hangup ? { hangup: true, action: "hangup" } : {})
    })
  ].join("\n");
}

export type SendAgentPhoneMessageOptions = {
  apiKey?: string;
  agentId?: string;
  baseUrl?: string;
  toNumber: string;
  body: string;
  numberId?: string;
  logApi?: boolean;
  fetchFn?: (input: string, init: RequestInit) => Promise<Response>;
};

export async function sendAgentPhoneMessage({
  apiKey,
  agentId,
  baseUrl = "https://api.agentphone.ai",
  toNumber,
  body,
  numberId,
  logApi = false,
  fetchFn = fetch
}: SendAgentPhoneMessageOptions): Promise<unknown> {
  if (!apiKey) throw new Error("AGENTPHONE_API_KEY is required to send post-call messages.");
  if (!agentId) throw new Error("AGENTPHONE_AGENT_ID is required to send post-call messages.");

  const url = `${baseUrl.replace(/\/+$/, "")}/v1/messages`;
  const requestBody = {
    agent_id: agentId,
    to_number: toNumber,
    body,
    ...(numberId ? { number_id: numberId } : {})
  };

  if (logApi) {
    console.log("AgentPhone API request", {
      method: "POST",
      url,
      body: requestBody
    });
  }

  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });

  const responseText = await response.text();
  if (logApi) {
    console.log("AgentPhone API response", {
      status: response.status,
      statusText: response.statusText,
      body: responseText
    });
  }

  if (!response.ok) {
    throw new Error(`AgentPhone message send failed: ${response.status} ${response.statusText} ${responseText}`);
  }

  return responseText ? JSON.parse(responseText) : {};
}
