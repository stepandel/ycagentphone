import { describe, expect, it } from "bun:test";
import { buildAnswerInputText, parseAnswerControl } from "../src/agent.js";
import { buildSystemPrompt } from "../src/prompt.js";

describe("parseAnswerControl", () => {
  it("keeps normal answers on the line", () => {
    expect(parseAnswerControl("Happy to help. Is there anything else I can help with?")).toEqual({
      text: "Happy to help. Is there anything else I can help with?"
    });
  });

  it("supports legacy end-call markers", () => {
    expect(parseAnswerControl("Thanks for calling. Goodbye. [[END_CALL]]")).toEqual({
      text: "Thanks for calling. Goodbye.",
      hangup: true
    });
  });

  it("supports explicit end-call tool requests", () => {
    expect(parseAnswerControl("Thanks for calling. Goodbye.", true)).toEqual({
      text: "Thanks for calling. Goodbye.",
      hangup: true
    });
  });
});

describe("buildAnswerInputText", () => {
  it("omits reservation-only context for non-reservation turns", () => {
    const text = buildAnswerInputText({
      transcript: "What is the most popular item on the menu?",
      channel: "voice",
      knowledge: [{ content: "The cioppino is popular.", source: "kb/menu.md" }]
    });

    expect(text).toContain("Knowledgebase search results:");
    expect(text).not.toContain("Matched call skill context:");
    expect(text).not.toContain("Existing reservation log:");
    expect(text).not.toContain("SQLite reservation availability:");
  });

  it("includes reservation context when supplied", () => {
    const text = buildAnswerInputText({
      transcript: "Can I reserve a table for two tonight?",
      channel: "voice",
      knowledge: [{ content: "Reservations are available.", source: "kb/reservation-availability.md" }],
      skillContext: "Skill: reservation-taking",
      reservationLogContext: "No reservation log entry was found for this caller.",
      reservationAvailabilityContext: "SQLite reservation availability: available."
    });

    expect(text).toContain("Matched call skill context:");
    expect(text).toContain("Existing reservation log:");
    expect(text).toContain("SQLite reservation availability:");
  });
});

describe("buildSystemPrompt", () => {
  it("asks the voice agent to check for more questions before ending completed calls", () => {
    const prompt = buildSystemPrompt("Your Restaurant", "hello@example.com");

    expect(prompt).toContain("ask one brief final check-in");
    expect(prompt).toContain("Do not end the call on that turn.");
    expect(prompt).toContain("call the end_call tool after the closing sentence");
  });
});
