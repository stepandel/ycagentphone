import { describe, expect, it } from "bun:test";
import { parseAnswerControl } from "../src/agent.js";
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

describe("buildSystemPrompt", () => {
  it("asks the voice agent to check for more questions before ending completed calls", () => {
    const prompt = buildSystemPrompt("Your Restaurant", "hello@example.com");

    expect(prompt).toContain("ask one brief final check-in");
    expect(prompt).toContain("Do not end the call on that turn.");
    expect(prompt).toContain("call the end_call tool after the closing sentence");
  });
});
