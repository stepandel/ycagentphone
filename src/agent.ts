import OpenAI from "openai";
import { config } from "./config.js";
import { formatKnowledgeSnippets, searchKnowledgebase, type KnowledgeSnippet } from "./memory.js";
import { buildSystemPrompt } from "./prompt.js";
import {
  formatAvailabilityContext,
  formatReservationContextForCaller,
  openReservationDatabase,
  seedDiningTables
} from "./reservation-store.js";
import { buildSkillContext } from "./skills/index.js";
import { isReservationQuery } from "./skills/reservation-taking.js";
import { observeOpenAIForTurn, withAnswerTrace, withKnowledgeRetrievalTrace } from "./tracing.js";
import type { VoiceAnswer } from "./agentphone.js";
import type { Response, ResponseCreateParamsNonStreaming, ResponseFunctionToolCall, ResponseInputItem, Tool } from "openai/resources/responses/responses";

const END_CALL_MARKER = "[[END_CALL]]";
const END_CALL_TOOL_NAME = "end_call";
const CHECK_RESERVATION_AVAILABILITY_TOOL_NAME = "check_reservation_availability";

const END_CALL_TOOL: Tool = {
  type: "function",
  name: END_CALL_TOOL_NAME,
  description:
    "End the active voice phone call only after the caller has explicitly said they are done, declined further help, or said goodbye.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: [],
    properties: {}
  },
  strict: true
};

const CHECK_RESERVATION_AVAILABILITY_TOOL: Tool = {
  type: "function",
  name: CHECK_RESERVATION_AVAILABILITY_TOOL_NAME,
  description:
    "Check live SQLite reservation availability for a party size, restaurant-local date, and restaurant-local time. Use this before saying a requested reservation time is available or unavailable.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["partySize", "date", "time"],
    properties: {
      partySize: {
        type: "integer",
        minimum: 1,
        description: "Number of guests in the party."
      },
      date: {
        type: "string",
        description: "Restaurant-local reservation date in YYYY-MM-DD format."
      },
      time: {
        type: "string",
        description: "Restaurant-local reservation start time in 24-hour HH:MM format."
      }
    }
  },
  strict: true
};

type PromptCacheResponseCreateParams = ResponseCreateParamsNonStreaming & {
  prompt_cache_key?: string;
};

export type AnswerOptions = {
  transcript?: string;
  isCallStart?: boolean;
  callId?: string;
  caller?: string;
  channel?: "voice" | "text";
  onToolCall?: (toolCall: { name: string; arguments: string }) => void | Promise<void>;
};

export type AnswerResult = string | VoiceAnswer;

export type AnswerService = (options: AnswerOptions) => Promise<AnswerResult>;

export type AnswerPromptContext = {
  transcript: string;
  channel: "voice" | "text";
  knowledge: KnowledgeSnippet[];
  callId?: string;
  caller?: string;
  skillContext?: string;
  reservationLogContext?: string;
  reservationAvailabilityContext?: string;
};

let openai: OpenAI | undefined;

function requestedEndCall(response: { output?: unknown[] }): boolean {
  return (
    response.output?.some((item): item is ResponseFunctionToolCall => {
      return (
        typeof item === "object" &&
        item !== null &&
        "type" in item &&
        item.type === "function_call" &&
        "name" in item &&
        item.name === END_CALL_TOOL_NAME
      );
    }) ?? false
  );
}

function functionToolCalls(response: { output?: unknown[] }, name?: string): ResponseFunctionToolCall[] {
  return (
    response.output?.filter((item): item is ResponseFunctionToolCall => {
      return (
        typeof item === "object" &&
        item !== null &&
        "type" in item &&
        item.type === "function_call" &&
        "name" in item &&
        typeof item.name === "string" &&
        (!name || item.name === name)
      );
    }) ?? []
  );
}

export function parseAnswerControl(text: string, shouldHangup = false): VoiceAnswer {
  const hangup = text.includes(END_CALL_MARKER);
  const cleanText = text.replaceAll(END_CALL_MARKER, "").trim();
  return {
    text: cleanText || (shouldHangup || hangup ? "Thanks for calling. Goodbye." : cleanText),
    ...(shouldHangup || hangup ? { hangup: true } : {})
  };
}

function getOpenAI(): OpenAI {
  if (!config.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required to answer caller turns.");
  }

  openai ??= new OpenAI({
    apiKey: config.OPENAI_API_KEY
  });

  return openai;
}

function restaurantDateToday(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: config.RESTAURANT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  })
    .formatToParts(new Date())
    .reduce<Record<string, string>>((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function restaurantDateTimeIso(date: string, time: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("date must use YYYY-MM-DD format.");
  }
  if (!/^\d{2}:\d{2}$/.test(time)) {
    throw new Error("time must use 24-hour HH:MM format.");
  }
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (hour > 23 || minute > 59) throw new Error("time must be a valid 24-hour HH:MM value.");

  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const offsetName = new Intl.DateTimeFormat("en-US", {
    timeZone: config.RESTAURANT_TIME_ZONE,
    timeZoneName: "shortOffset"
  })
    .formatToParts(utcGuess)
    .find((part) => part.type === "timeZoneName")?.value;
  const match = offsetName?.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
  const offsetMinutes = match ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] ?? "0")) : -utcGuess.getTimezoneOffset();
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - offsetMinutes * 60_000).toISOString();
}

export function checkReservationAvailabilityTool(argumentsJson: string): string {
  try {
    const args = JSON.parse(argumentsJson) as {
      partySize?: unknown;
      date?: unknown;
      time?: unknown;
      durationMinutes?: unknown;
    };
    if (!Number.isInteger(args.partySize) || Number(args.partySize) <= 0) {
      throw new Error("partySize must be a positive integer.");
    }
    if (typeof args.date !== "string") throw new Error("date is required.");
    if (typeof args.time !== "string") throw new Error("time is required.");
    const durationMinutes = args.durationMinutes === undefined ? undefined : Number(args.durationMinutes);
    if (durationMinutes !== undefined && (!Number.isInteger(durationMinutes) || durationMinutes <= 0)) {
      throw new Error("durationMinutes must be a positive integer.");
    }

    const startsAt = restaurantDateTimeIso(args.date, args.time);
    const db = openReservationDatabase();
    try {
      seedDiningTables(db);
      return JSON.stringify({
        ok: true,
        restaurantTimeZone: config.RESTAURANT_TIME_ZONE,
        summary: formatAvailabilityContext(db, {
          partySize: Number(args.partySize),
          startsAt,
          durationMinutes
        })
      });
    } finally {
      db.close();
    }
  } catch (error) {
    return JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown availability check error."
    });
  }
}

function toolsForChannel(channel: "voice" | "text"): Tool[] {
  return channel === "voice" ? [END_CALL_TOOL, CHECK_RESERVATION_AVAILABILITY_TOOL] : [CHECK_RESERVATION_AVAILABILITY_TOOL];
}

export function buildAnswerInputText(context: AnswerPromptContext): string {
  return [
    `Communication channel: ${context.channel}`,
    `Current restaurant date: ${restaurantDateToday()}`,
    `Restaurant time zone: ${config.RESTAURANT_TIME_ZONE}`,
    context.skillContext ? "Matched call skill context:" : undefined,
    context.skillContext,
    "Knowledgebase search results:",
    formatKnowledgeSnippets(context.knowledge),
    context.callId ? `Call ID: ${context.callId}` : undefined,
    context.caller ? `Caller: ${context.caller}` : undefined,
    context.reservationLogContext ? "Existing reservation log:" : undefined,
    context.reservationLogContext,
    context.reservationAvailabilityContext ? "SQLite reservation availability:" : undefined,
    context.reservationAvailabilityContext,
    "Caller transcript:",
    context.transcript
  ]
    .filter(Boolean)
    .join("\n");
}

function promptCacheKey(channel: "voice" | "text"): string {
  const company = config.COMPANY_NAME.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "restaurant";
  return `agentphone-${company}-${channel}`;
}

export const answerCaller: AnswerService = async ({ transcript, isCallStart, callId, caller, channel = "voice", onToolCall }) => withAnswerTrace({ transcript, isCallStart, callId, caller }, async () => {
  if (isCallStart || !transcript?.trim()) {
    return config.RESTAURANT_GREETING;
  }

  const knowledge = await withKnowledgeRetrievalTrace(transcript, () => searchKnowledgebase(transcript));
  const includeReservationContext = isReservationQuery(transcript);
  const skillContext = includeReservationContext ? buildSkillContext(transcript) : undefined;
  const reservationLogContext = includeReservationContext ? formatReservationContextForCaller(caller) : undefined;
  const tools = toolsForChannel(channel);

  const responseParams: PromptCacheResponseCreateParams = {
    model: config.OPENAI_MODEL,
    instructions: buildSystemPrompt(config.COMPANY_NAME, config.PUBLIC_CONTACT_EMAIL),
    tools,
    tool_choice: "auto" as const,
    prompt_cache_key: promptCacheKey(channel),
    user: caller,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: buildAnswerInputText({
              transcript,
              channel,
              callId,
              caller,
              knowledge,
              skillContext,
              reservationLogContext
            })
          }
        ]
      }
    ]
  };

  const openaiForTurn = observeOpenAIForTurn(getOpenAI(), { transcript, isCallStart, callId, caller });
  let response: Response = await openaiForTurn.responses.create(responseParams);
  let shouldHangup = requestedEndCall(response);

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const calls = functionToolCalls(response, CHECK_RESERVATION_AVAILABILITY_TOOL_NAME);
    if (calls.length === 0) break;

    await Promise.all(calls.map((call) => onToolCall?.({ name: call.name, arguments: call.arguments })));

    const toolOutputs: ResponseInputItem[] = calls.map((call) => ({
      type: "function_call_output",
      call_id: call.call_id,
      output: checkReservationAvailabilityTool(call.arguments)
    }));

    const followUpParams: PromptCacheResponseCreateParams = {
      model: config.OPENAI_MODEL,
      instructions: buildSystemPrompt(config.COMPANY_NAME, config.PUBLIC_CONTACT_EMAIL),
      previous_response_id: response.id,
      input: toolOutputs,
      tools,
      tool_choice: "auto",
      prompt_cache_key: promptCacheKey(channel),
      user: caller
    };

    response = await openaiForTurn.responses.create(followUpParams);
    shouldHangup = shouldHangup || requestedEndCall(response);
  }

  return parseAnswerControl(response.output_text.trim(), shouldHangup);
});
