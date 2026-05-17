import Supermemory from "supermemory";
import { config } from "./config.js";

export type KnowledgeSnippet = {
  content: string;
  source?: string;
  score?: number;
};

let supermemory: Supermemory | undefined;

function getSupermemory(): Supermemory {
  if (!config.SUPERMEMORY_API_KEY) {
    throw new Error("SUPERMEMORY_API_KEY is required to search the knowledgebase.");
  }

  supermemory ??= new Supermemory({
    apiKey: config.SUPERMEMORY_API_KEY
  });

  return supermemory;
}

export async function searchKnowledgebase(query: string): Promise<KnowledgeSnippet[]> {
  const results = await getSupermemory().search.memories({
    q: query,
    containerTag: config.SUPERMEMORY_CONTAINER_TAG,
    searchMode: config.SUPERMEMORY_SEARCH_MODE,
    limit: config.SUPERMEMORY_SEARCH_LIMIT,
    rerank: true
  });

  return results.results
    .map((result) => ({
      content: result.memory ?? result.chunk ?? result.chunks?.map((chunk) => chunk.content).join("\n\n") ?? "",
      source: typeof result.metadata?.source === "string" ? result.metadata.source : undefined,
      score: result.similarity
    }))
    .filter((snippet) => snippet.content.trim().length > 0);
}

export function formatKnowledgeSnippets(snippets: KnowledgeSnippet[]): string {
  if (snippets.length === 0) {
    return "No matching knowledgebase entries were found.";
  }

  return snippets
    .map((snippet, index) => {
      const source = snippet.source ? `\nSource: ${snippet.source}` : "";
      const score = typeof snippet.score === "number" ? `\nSimilarity: ${snippet.score.toFixed(3)}` : "";
      return `[${index + 1}]${source}${score}\n${snippet.content}`;
    })
    .join("\n\n---\n\n");
}
