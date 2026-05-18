import OpenAI from "openai";
import { config } from "./config.js";
import { formatKnowledgeSnippets, searchKnowledgebase, type KnowledgeSnippet } from "./memory.js";
import { buildSystemPrompt } from "./prompt.js";
import { formatAvailabilityContextForTranscript, formatReservationContextForCaller } from "./reservation-store.js";
import { buildSkillContext } from "./skills/index.js";
import { isReservationQuery } from "./skills/reservation-taking.js";
import { observeOpenAIForTurn, withAnswerTrace, withKnowledgeRetrievalTrace } from "./tracing.js";
import type { VoiceAnswer } from "./agentphone.js";
import type { ResponseCreateParamsNonStreaming, ResponseFunctionToolCall, Tool } from "openai/resources/responses/responses";

const END_CALL_MARKER = "[[END_CALL]]";
const END_CALL_TOOL_NAME = "end_call";

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

type PromptCacheResponseCreateParams = ResponseCreateParamsNonStreaming & {
  prompt_cache_key?: string;
};

export type AnswerOptions = {
  transcript?: string;
  isCallStart?: boolean;
  callId?: string;
  caller?: string;
  channel?: "voice" | "text";
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

export function buildAnswerInputText(context: AnswerPromptContext): string {
  return [
    `Communication channel: ${context.channel}`,
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

export const answerCaller: AnswerService = async ({ transcript, isCallStart, callId, caller, channel = "voice" }) => withAnswerTrace({ transcript, isCallStart, callId, caller }, async () => {
  if (isCallStart || !transcript?.trim()) {
    return config.RESTAURANT_GREETING;
  }

  const knowledge = await withKnowledgeRetrievalTrace(transcript, () => searchKnowledgebase(transcript));
  const includeReservationContext = isReservationQuery(transcript);
  const skillContext = includeReservationContext ? buildSkillContext(transcript) : undefined;
  const reservationLogContext = includeReservationContext ? formatReservationContextForCaller(caller) : undefined;
  const reservationAvailabilityContext = includeReservationContext ? formatAvailabilityContextForTranscript(transcript) : undefined;

  const responseParams: PromptCacheResponseCreateParams = {
    model: config.OPENAI_MODEL,
    instructions: buildSystemPrompt(config.COMPANY_NAME, config.PUBLIC_CONTACT_EMAIL),
    ...(channel === "voice" ? { tools: [END_CALL_TOOL], tool_choice: "auto" as const } : {}),
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
              reservationLogContext,
              reservationAvailabilityContext
            })
          }
        ]
      }
    ]
  };

  const response = await observeOpenAIForTurn(getOpenAI(), { transcript, isCallStart, callId, caller }).responses.create(responseParams);

  return parseAnswerControl(response.output_text.trim(), requestedEndCall(response));
});
