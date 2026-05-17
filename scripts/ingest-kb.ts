import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { MossClient, type DocumentInfo } from "@moss-dev/moss";

const root = process.cwd();
const kbDir = path.join(root, "kb");
const indexName = process.env.MOSS_INDEX_NAME || "ycagentphone-restaurant-kb";
const modelId = process.env.MOSS_MODEL_ID || "moss-minilm";
const maxChunkCharacters = Number(process.env.MOSS_INGEST_MAX_CHUNK_CHARACTERS || 2400);
const overlapParagraphs = Number(process.env.MOSS_INGEST_OVERLAP_PARAGRAPHS || 1);

function getMoss(): MossClient {
  if (!process.env.MOSS_PROJECT_ID || !process.env.MOSS_PROJECT_KEY) {
    throw new Error("MOSS_PROJECT_ID and MOSS_PROJECT_KEY are required.");
  }

  return new MossClient(process.env.MOSS_PROJECT_ID, process.env.MOSS_PROJECT_KEY);
}

function customIdForPath(relativePath: string): string {
  const parsed = path.parse(relativePath);
  const withoutExtension = path.join(parsed.dir, parsed.name);
  return withoutExtension
    .replace(/[^a-zA-Z0-9:_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100);
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return listMarkdownFiles(fullPath);
      if (entry.isFile() && entry.name.endsWith(".md")) return [fullPath];
      return [];
    })
  );
  return files.flat().sort();
}

function chunkMarkdown(content: string): string[] {
  const paragraphs = content
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current: string[] = [];
  let currentLength = 0;

  for (const paragraph of paragraphs) {
    const nextLength = currentLength + paragraph.length + (current.length === 0 ? 0 : 2);
    if (current.length > 0 && nextLength > maxChunkCharacters) {
      chunks.push(current.join("\n\n"));
      current = overlapParagraphs > 0 ? current.slice(-overlapParagraphs) : [];
      currentLength = current.join("\n\n").length;
    }

    current.push(paragraph);
    currentLength += paragraph.length + (current.length === 1 ? 0 : 2);
  }

  if (current.length > 0) {
    chunks.push(current.join("\n\n"));
  }

  return chunks.length > 0 ? chunks : [content.trim()].filter(Boolean);
}

function documentsForFile(relativePath: string, content: string): DocumentInfo[] {
  const baseId = customIdForPath(relativePath);
  return chunkMarkdown(content).map((text, index) => ({
    id: `${baseId}__chunk_${String(index + 1).padStart(3, "0")}`,
    text,
    metadata: {
      source: relativePath,
      chunk: String(index + 1),
      type: "knowledgebase"
    }
  }));
}

async function main() {
  const moss = getMoss();
  const files = await listMarkdownFiles(kbDir);
  if (files.length === 0) {
    throw new Error(`No markdown files found in ${kbDir}.`);
  }

  const documents: DocumentInfo[] = [];
  const sources = new Set<string>();

  for (const filePath of files) {
    const relativePath = path.relative(root, filePath);
    const content = await fs.readFile(filePath, "utf8");
    const fileDocuments = documentsForFile(relativePath, content);

    sources.add(relativePath);
    documents.push(...fileDocuments);
    console.log(`${relativePath}: prepared ${fileDocuments.length} chunk(s)`);
  }

  const indexes = await moss.listIndexes();
  const indexExists = indexes.some((index) => index.name === indexName);

  if (!indexExists) {
    const result = await moss.createIndex(indexName, documents, { modelId });
    console.log(`Created Moss index ${indexName}: ${result.jobId}`);
  } else {
    const existingDocuments = await moss.getDocs(indexName);
    const staleDocumentIds = existingDocuments
      .filter((document) => document.metadata?.source && sources.has(document.metadata.source))
      .map((document) => document.id);

    if (staleDocumentIds.length > 0) {
      await moss.deleteDocs(indexName, staleDocumentIds);
      console.log(`Deleted ${staleDocumentIds.length} stale chunk(s) from ${indexName}`);
    }

    const result = await moss.addDocs(indexName, documents, { upsert: true });
    console.log(`Updated Moss index ${indexName}: ${result.jobId}`);
  }

  console.log(`Knowledgebase indexed in Moss index: ${indexName} (${documents.length} chunks)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
