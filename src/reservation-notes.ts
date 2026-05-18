import OpenAI from "openai";
import { config } from "./config.js";

export const RESERVATION_NOTES_TARGET_CHARS = 200;

const SUMMARY_INSTRUCTIONS = `You consolidate restaurant reservation notes into a single short sentence (under ${RESERVATION_NOTES_TARGET_CHARS} characters) that staff can scan at a glance. Preserve guest preferences, allergies, dietary restrictions, special occasions, accessibility needs, and the latest agreed reservation changes (date, time, party size, name). Drop greetings, repetition, the agent's own confirmations, and Stripe link URLs. Output only the summary text — no labels, no quotes.`;

export type ReservationNoteSummarizer = (text: string) => Promise<string>;

let openai: OpenAI | undefined;

function getOpenAI(): OpenAI {
  if (!config.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required to summarize reservation notes.");
  }
  openai ??= new OpenAI({ apiKey: config.OPENAI_API_KEY });
  return openai;
}

export async function summarizeReservationNote(text: string): Promise<string> {
  const response = await getOpenAI().responses.create({
    model: config.OPENAI_MODEL,
    instructions: SUMMARY_INSTRUCTIONS,
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text }]
      }
    ]
  });
  return response.output_text.trim().replace(/\s+/g, " ");
}
