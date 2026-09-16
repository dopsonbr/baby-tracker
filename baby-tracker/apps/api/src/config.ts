import { ApiError } from "./errors.js"
export function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value)
    throw new ApiError(
      503,
      "not_configured",
      "The private app is not configured yet. Please complete server setup."
    )
  return value
}
export function splitList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
}
/** Verified against https://ai-gateway.vercel.sh/v1/models on 2026-09-16. */
export const DEFAULT_AI_MODEL = "openai/gpt-5.6-luna"
export function modelId(): string {
  return process.env.AI_MODEL?.trim() || DEFAULT_AI_MODEL
}
