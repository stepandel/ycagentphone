import OpenAI from "openai";
import { config } from "./config.js";
import { formatKnowledgeSnippets, searchKnowledgebase } from "./memory.js";
import { buildSystemPrompt } from "./prompt.js";
import { formatReservationLogContextForCaller } from "./reservation-log.js";
import { formatAvailabilityContextForTranscript } from "./reservation-store.js";
import { buildSkillContext } from "./skills/index.js";
import { observeOpenAIForTurn, withAnswerTrace, withKnowledgeRetrievalTrace } from "./tracing.js";
import type { VoiceAnswer } from "./agentphone.js";
import type { ResponseFunctionToolCall, Tool } from "openai/resources/responses/responses";

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

export type AnswerOptions = {
  transcript?: string;
  isCallStart?: boolean;
  callId?: string;
  caller?: string;
  channel?: "voice" | "text";
};

export type AnswerResult = string | VoiceAnswer;

export type AnswerService = (options: AnswerOptions) => Promise<AnswerResult>;

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

export const answerCaller: AnswerService = async ({ transcript, isCallStart, callId, caller, channel = "voice" }) => withAnswerTrace({ transcript, isCallStart, callId, caller }, async () => {
  if (isCallStart || !transcript?.trim()) {
    return config.RESTAURANT_GREETING;
  }

  const knowledge = await withKnowledgeRetrievalTrace(transcript, () => searchKnowledgebase(transcript));
  const skillContext = buildSkillContext(transcript);
  const reservationLogContext = await formatReservationLogContextForCaller(caller);
  const reservationAvailabilityContext = formatAvailabilityContextForTranscript(transcript);

  const response = await observeOpenAIForTurn(getOpenAI(), { transcript, isCallStart, callId, caller }).responses.create({
    model: config.OPENAI_MODEL,
    instructions: buildSystemPrompt(config.COMPANY_NAME, config.PUBLIC_CONTACT_EMAIL),
    ...(channel === "voice" ? { tools: [END_CALL_TOOL], tool_choice: "auto" as const } : {}),
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              callId ? `Call ID: ${callId}` : undefined,
              caller ? `Caller: ${caller}` : undefined,
              `Communication channel: ${channel}`,
              "Matched call skill context:",
              skillContext,
              "Existing reservation log:",
              reservationLogContext,
              "SQLite reservation availability:",
              reservationAvailabilityContext,
              "Knowledgebase search results:",
              formatKnowledgeSnippets(knowledge),
              "Caller transcript:",
              transcript
            ]
              .filter(Boolean)
              .join("\n")
          }
        ]
      }
    ]
  });

  return parseAnswerControl(response.output_text.trim(), requestedEndCall(response));
});
