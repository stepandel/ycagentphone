import { LangfuseSpanProcessor } from "@langfuse/otel";
import { observeOpenAI } from "@langfuse/openai";
import { propagateAttributes, startActiveObservation } from "@langfuse/tracing";
import { NodeSDK } from "@opentelemetry/sdk-node";
import type OpenAI from "openai";
import { config } from "./config.js";
import type { AnswerOptions } from "./agent.js";
import type { KnowledgeSnippet } from "./memory.js";

let sdk: NodeSDK | undefined;
let started = false;

export function isLangfuseTracingEnabled(): boolean {
  return Boolean(config.LANGFUSE_TRACING_ENABLED && config.LANGFUSE_PUBLIC_KEY && config.LANGFUSE_SECRET_KEY);
}

export function initLangfuseTracing(): void {
  if (started || !isLangfuseTracingEnabled()) return;

  sdk = new NodeSDK({
    serviceName: "ycagentphone",
    spanProcessors: [
      new LangfuseSpanProcessor({
        publicKey: config.LANGFUSE_PUBLIC_KEY,
        secretKey: config.LANGFUSE_SECRET_KEY,
        baseUrl: config.LANGFUSE_BASE_URL,
        environment: config.LANGFUSE_TRACING_ENVIRONMENT,
        release: config.LANGFUSE_RELEASE
      })
    ]
  });
  sdk.start();
  started = true;
}

export async function shutdownLangfuseTracing(): Promise<void> {
  if (!sdk) return;
  await sdk.shutdown();
  sdk = undefined;
  started = false;
}

export function observeOpenAIForTurn(openai: OpenAI, options: AnswerOptions): OpenAI {
  if (!isLangfuseTracingEnabled()) return openai;

  return observeOpenAI(openai, {
    traceName: "agentphone.answer",
    generationName: "openai.responses.create",
    sessionId: options.callId,
    userId: options.caller,
    tags: ["agentphone", "restaurant-phone"],
    generationMetadata: {
      callId: options.callId,
      caller: options.caller,
      model: config.OPENAI_MODEL
    }
  }) as OpenAI;
}

export async function withAnswerTrace<T>(options: AnswerOptions, fn: () => Promise<T>): Promise<T> {
  if (!isLangfuseTracingEnabled()) return fn();

  initLangfuseTracing();

  return propagateAttributes(
    {
      traceName: "agentphone.answer",
      sessionId: options.callId,
      userId: options.caller,
      tags: ["agentphone", "restaurant-phone"],
      metadata: {
        source: "agentphone",
        ...(options.callId ? { callId: options.callId } : {}),
        ...(options.caller ? { caller: options.caller } : {})
      }
    },
    async () =>
      startActiveObservation(
        "agentphone.answer",
        async (observation) => {
          observation.update({
            input: {
              transcript: options.transcript,
              isCallStart: options.isCallStart,
              callId: options.callId,
              caller: options.caller
            }
          });

          try {
            const result = await fn();
            observation.update({ output: result });
            return result;
          } catch (error) {
            observation.update({
              level: "ERROR",
              statusMessage: error instanceof Error ? error.message : String(error)
            });
            throw error;
          }
        },
        {
          asType: "agent"
        }
      )
  );
}

export async function withKnowledgeRetrievalTrace<T extends KnowledgeSnippet[]>(
  query: string,
  fn: () => Promise<T>
): Promise<T> {
  if (!isLangfuseTracingEnabled()) return fn();

  return startActiveObservation(
    "moss.search",
    async (observation) => {
      observation.update({ input: { query } });

      try {
        const results = await fn();
        observation.update({
          output: results,
          metadata: {
            indexName: config.MOSS_INDEX_NAME,
            alpha: config.MOSS_SEARCH_ALPHA,
            limit: config.MOSS_SEARCH_LIMIT
          }
        });
        return results;
      } catch (error) {
        observation.update({
          level: "ERROR",
          statusMessage: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    },
    {
      asType: "retriever"
    }
  );
}
