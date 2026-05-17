import { MossClient } from "@moss-dev/moss";
import { config } from "./config.js";

export type KnowledgeSnippet = {
  content: string;
  source?: string;
  score?: number;
};

let moss: MossClient | undefined;
let loadedIndex: Promise<string> | undefined;

function getMoss(): MossClient {
  if (!config.MOSS_PROJECT_ID || !config.MOSS_PROJECT_KEY) {
    throw new Error("MOSS_PROJECT_ID and MOSS_PROJECT_KEY are required to search the knowledgebase.");
  }

  moss ??= new MossClient(config.MOSS_PROJECT_ID, config.MOSS_PROJECT_KEY);

  return moss;
}

async function loadKnowledgeIndex(): Promise<string> {
  loadedIndex ??= getMoss().loadIndex(config.MOSS_INDEX_NAME, {
    autoRefresh: config.MOSS_AUTO_REFRESH,
    pollingIntervalInSeconds: config.MOSS_AUTO_REFRESH_INTERVAL_SECONDS,
    ...(config.MOSS_CACHE_PATH ? { cachePath: config.MOSS_CACHE_PATH } : {})
  });

  try {
    return await loadedIndex;
  } catch (error) {
    loadedIndex = undefined;
    throw error;
  }
}

export async function searchKnowledgebase(query: string): Promise<KnowledgeSnippet[]> {
  await loadKnowledgeIndex();

  const results = await getMoss().query(config.MOSS_INDEX_NAME, query, {
    topK: config.MOSS_SEARCH_LIMIT,
    alpha: config.MOSS_SEARCH_ALPHA
  });

  return results.docs
    .map((result) => ({
      content: result.text,
      source: result.metadata?.source,
      score: result.score
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
