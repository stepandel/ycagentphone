import "dotenv/config";
import { z } from "zod";

const optionalNonEmptyString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional()
);

const envSchema = z.object({
  OPENAI_API_KEY: optionalNonEmptyString,
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
  OPENAI_VECTOR_STORE_ID: optionalNonEmptyString,
  AGENTPHONE_WEBHOOK_SECRET: optionalNonEmptyString,
  COMPANY_NAME: z.string().default("Your Company"),
  PUBLIC_CONTACT_EMAIL: z.string().email().default("sales@example.com"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info")
});

export const config = envSchema.parse(process.env);
