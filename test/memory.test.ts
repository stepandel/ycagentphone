import { describe, expect, it } from "bun:test";
import { formatKnowledgeSnippets } from "../src/memory.js";

describe("formatKnowledgeSnippets", () => {
  it("formats Moss search snippets with source and score metadata", () => {
    expect(
      formatKnowledgeSnippets([
        {
          content: "Large parties use the prix fixe menu.",
          source: "kb/prix-fixe-large-parties.md",
          score: 0.8764
        }
      ])
    ).toBe("[1]\nSource: kb/prix-fixe-large-parties.md\nSimilarity: 0.876\nLarge parties use the prix fixe menu.");
  });

  it("handles empty retrieval results", () => {
    expect(formatKnowledgeSnippets([])).toBe("No matching knowledgebase entries were found.");
  });

  it("caps long snippets before adding them to the answer prompt", () => {
    const formatted = formatKnowledgeSnippets([
      {
        content: "a".repeat(1500),
        source: "kb/menu.md",
        score: 1
      }
    ]);

    expect(formatted).toContain("\n[truncated]");
    expect(formatted.length).toBeLessThan(1500);
  });
});
