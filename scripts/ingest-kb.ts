import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import OpenAI, { toFile } from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const root = process.cwd();
const kbDir = path.join(root, "kb");

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

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required.");
  }

  const files = await listMarkdownFiles(kbDir);
  if (files.length === 0) {
    throw new Error(`No markdown files found in ${kbDir}.`);
  }

  const vectorStore =
    process.env.OPENAI_VECTOR_STORE_ID && process.env.OPENAI_VECTOR_STORE_ID.trim().length > 0
      ? await openai.vectorStores.retrieve(process.env.OPENAI_VECTOR_STORE_ID)
      : await openai.vectorStores.create({ name: "ycagentphone-kb" });

  const uploadFiles = await Promise.all(
    files.map(async (filePath) => {
      const content = await fs.readFile(filePath);
      return toFile(content, path.relative(root, filePath), { type: "text/markdown" });
    })
  );

  await openai.vectorStores.fileBatches.uploadAndPoll(vectorStore.id, {
    files: uploadFiles
  });

  console.log(`Vector store ready: ${vectorStore.id}`);
  console.log("Add this to .env:");
  console.log(`OPENAI_VECTOR_STORE_ID=${vectorStore.id}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
