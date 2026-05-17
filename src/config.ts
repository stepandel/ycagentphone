import "dotenv/config";
import { z } from "zod";

const optionalNonEmptyString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional()
);

const optionalBoolean = z.preprocess((value) => {
  if (value === "" || value === undefined) return undefined;
  if (typeof value === "string") return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  return value;
}, z.boolean().optional());

const envSchema = z.object({
  OPENAI_API_KEY: optionalNonEmptyString,
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
  LANGFUSE_TRACING_ENABLED: optionalBoolean.default(true),
  LANGFUSE_PUBLIC_KEY: optionalNonEmptyString,
  LANGFUSE_SECRET_KEY: optionalNonEmptyString,
  LANGFUSE_BASE_URL: optionalNonEmptyString,
  LANGFUSE_TRACING_ENVIRONMENT: optionalNonEmptyString,
  LANGFUSE_RELEASE: optionalNonEmptyString,
  SUPERMEMORY_API_KEY: optionalNonEmptyString,
  SUPERMEMORY_CONTAINER_TAG: z.string().min(1).default("ycagentphone-restaurant-kb"),
  SUPERMEMORY_SEARCH_LIMIT: z.coerce.number().int().positive().default(8),
  SUPERMEMORY_SEARCH_MODE: z.enum(["memories", "hybrid", "documents"]).default("hybrid"),
  AGENTPHONE_WEBHOOK_SECRET: optionalNonEmptyString,
  COMPANY_NAME: z.string().default("Your Restaurant"),
  RESTAURANT_GREETING: z.string().default("Good evening, and thank you for calling. This is the restaurant's virtual host. How may I help you today?"),
  RESTAURANT_PROCESSING_MESSAGE: z.string().default("Of course. Let me check that for you."),
  PUBLIC_CONTACT_EMAIL: z.string().email().default("sales@example.com"),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("::"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info")
});

export const config = envSchema.parse(process.env);
