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

const agentPhoneBaseUrl = z.preprocess(
  (value) => (value === "" || value === undefined ? undefined : value),
  z.string().url().default("https://api.agentphone.ai")
);

const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional()
);

const envSchema = z.object({
  OPENAI_API_KEY: optionalNonEmptyString,
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
  LANGFUSE_TRACING_ENABLED: optionalBoolean.default(true),
  LANGFUSE_PUBLIC_KEY: optionalNonEmptyString,
  LANGFUSE_SECRET_KEY: optionalNonEmptyString,
  LANGFUSE_BASE_URL: optionalNonEmptyString,
  LANGFUSE_TRACING_ENVIRONMENT: optionalNonEmptyString,
  LANGFUSE_RELEASE: optionalNonEmptyString,
  MOSS_PROJECT_ID: optionalNonEmptyString,
  MOSS_PROJECT_KEY: optionalNonEmptyString,
  MOSS_INDEX_NAME: z.string().min(1).default("ycagentphone-restaurant-kb"),
  MOSS_SEARCH_LIMIT: z.coerce.number().int().positive().default(8),
  MOSS_SEARCH_ALPHA: z.coerce.number().min(0).max(1).default(0.8),
  MOSS_AUTO_REFRESH: optionalBoolean.default(true),
  MOSS_AUTO_REFRESH_INTERVAL_SECONDS: z.coerce.number().int().positive().default(300),
  MOSS_CACHE_PATH: optionalNonEmptyString,
  MOSS_MODEL_ID: z.enum(["moss-minilm", "moss-mediumlm"]).default("moss-minilm"),
  AGENTPHONE_WEBHOOK_SECRET: optionalNonEmptyString,
  AGENTPHONE_API_KEY: optionalNonEmptyString,
  AGENTPHONE_AGENT_ID: optionalNonEmptyString,
  AGENTPHONE_BASE_URL: agentPhoneBaseUrl,
  STRIPE_SECRET_KEY: optionalNonEmptyString,
  STRIPE_RESERVATION_PAYMENT_LINK_URL: optionalUrl,
  STRIPE_RESERVATION_DEPOSIT_AMOUNT_CENTS: z.coerce.number().int().positive().default(10000),
  STRIPE_RESERVATION_DEPOSIT_CURRENCY: z.string().min(3).max(3).default("usd"),
  COMPANY_NAME: z.string().default("Your Restaurant"),
  RESTAURANT_GREETING: z.string().default("Good evening, and thank you for calling. This is the restaurant's virtual host. How may I help you today?"),
  RESTAURANT_PROCESSING_MESSAGE: z.string().default("Of course. Let me check that for you."),
  PUBLIC_CONTACT_EMAIL: z.string().email().default("sales@example.com"),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("::"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info")
});

export const config = envSchema.parse(process.env);
