import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/** Small, fast model for receipt reading and recipe ideas. Override with LARDER_AI_MODEL. */
export const AI_MODEL = process.env.LARDER_AI_MODEL || "claude-haiku-5-5";

/** Per attempt. Routes allow 60 s in all, so a retry mostly helps after a quick 429 or 5xx. */
export const AI_TIMEOUT_MS = 45_000;

let client: Anthropic | null = null;

/** Returns null when no API key is configured, so routes can fall back gracefully. */
export function getAnthropic(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  // One retry at most and a firm timeout, so a slow API can't hold a request past the route's maxDuration.
  client ??= new Anthropic({ timeout: AI_TIMEOUT_MS, maxRetries: 1 });
  return client;
}

export const AI_NOT_CONFIGURED = {
  error: "ai_not_configured",
  message: "AI features need an Anthropic API key. Add ANTHROPIC_API_KEY to the server environment.",
} as const;
