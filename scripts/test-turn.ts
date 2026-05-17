import "dotenv/config";
import { answerCaller } from "../src/agent.js";

const transcript = process.argv.slice(2).join(" ").trim();

if (!transcript) {
  console.error('Usage: bun run test:turn -- "What do you cost?"');
  process.exit(1);
}

const answer = await answerCaller({ transcript });
console.log(answer);
