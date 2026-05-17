import type { ReservationDetails } from "./post-call.js";

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

export function extractReservationUpdatesFromText(transcript: string): Partial<ReservationDetails> | undefined {
  const text = transcript.trim();
  const updates: Partial<ReservationDetails> = {};
  const partyMatch = text.match(/\b(?:party|table|reservation)\s+(?:of|for)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i);
  const timeMatch =
    text.match(/\b(?:make it|move (?:it|us)|change (?:it|the time|my reservation)|switch (?:it|us)|can we do|could we do)\s+(?:to\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i) ??
    text.match(/\b(?:move|change|switch)\s+(?:the\s+)?reservation\s+(?:to|for)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i) ??
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
