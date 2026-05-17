import OpenAI from "openai";
import { config } from "./config.js";
import { formatKnowledgeSnippets, searchKnowledgebase } from "./memory.js";
import { buildSystemPrompt } from "./prompt.js";

export type AnswerOptions = {
  transcript: string;
  callId?: string;
  caller?: string;
};

export type AnswerService = (options: AnswerOptions) => Promise<string>;

let openai: OpenAI | undefined;

function getOpenAI(): OpenAI {
  if (!config.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required to answer caller turns.");
  }

  openai ??= new OpenAI({
    apiKey: config.OPENAI_API_KEY
  });

  return openai;
}

export const answerCaller: AnswerService = async ({ transcript, callId, caller }) => {
  const knowledge = await searchKnowledgebase(transcript);

  const response = await getOpenAI().responses.create({
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

  return response.output_text.trim();
};
