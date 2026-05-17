import OpenAI from "openai";
import { config } from "./config.js";
import { formatKnowledgeSnippets, searchKnowledgebase } from "./memory.js";
import { buildSystemPrompt } from "./prompt.js";
import { formatReservationLogContextForCaller } from "./reservation-log.js";
import { buildSkillContext } from "./skills/index.js";
import { observeOpenAIForTurn, withAnswerTrace, withKnowledgeRetrievalTrace } from "./tracing.js";
import type { VoiceAnswer } from "./agentphone.js";

const END_CALL_MARKER = "[[END_CALL]]";

export type AnswerOptions = {
  transcript?: string;
  isCallStart?: boolean;
  callId?: string;
  caller?: string;
};

export type AnswerResult = string | VoiceAnswer;

export type AnswerService = (options: AnswerOptions) => Promise<AnswerResult>;

let openai: OpenAI | undefined;

function parseAnswerControl(text: string): VoiceAnswer {
  const hangup = text.includes(END_CALL_MARKER);
  return {
    text: text.replaceAll(END_CALL_MARKER, "").trim(),
    ...(hangup ? { hangup: true } : {})
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

export const answerCaller: AnswerService = async ({ transcript, isCallStart, callId, caller }) => withAnswerTrace({ transcript, isCallStart, callId, caller }, async () => {
  if (isCallStart || !transcript?.trim()) {
    return config.RESTAURANT_GREETING;
  }

  const knowledge = await withKnowledgeRetrievalTrace(transcript, () => searchKnowledgebase(transcript));
  const skillContext = buildSkillContext(transcript);
  const reservationLogContext = await formatReservationLogContextForCaller(caller);

  const response = await observeOpenAIForTurn(getOpenAI(), { transcript, isCallStart, callId, caller }).responses.create({
    model: config.OPENAI_MODEL,
    instructions: buildSystemPrompt(config.COMPANY_NAME, config.PUBLIC_CONTACT_EMAIL),
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              callId ? `Call ID: ${callId}` : undefined,
              caller ? `Caller: ${caller}` : undefined,
              "Matched call skill context:",
              skillContext,
              "Existing reservation log:",
              reservationLogContext,
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

  return parseAnswerControl(response.output_text.trim());
});
