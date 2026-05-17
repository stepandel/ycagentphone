import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import Supermemory from "supermemory";

const supermemory = new Supermemory({ apiKey: process.env.SUPERMEMORY_API_KEY });
const root = process.cwd();
const kbDir = path.join(root, "kb");
const containerTag = process.env.SUPERMEMORY_CONTAINER_TAG || "ycagentphone-kb";

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

async function main() {
  if (!process.env.SUPERMEMORY_API_KEY) {
    throw new Error("SUPERMEMORY_API_KEY is required.");
  }

  const files = await listMarkdownFiles(kbDir);
  if (files.length === 0) {
    throw new Error(`No markdown files found in ${kbDir}.`);
  }

  for (const filePath of files) {
    const relativePath = path.relative(root, filePath);
    const content = await fs.readFile(filePath, "utf8");
    const customId = customIdForPath(relativePath);

    const result = await supermemory.add({
      content,
      customId,
      containerTag,
      metadata: {
        source: relativePath,
        type: "knowledgebase"
      }
    });

    console.log(`${relativePath}: ${result.id} (${result.status})`);
  }

  console.log(`Knowledgebase queued in Supermemory container: ${containerTag}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
