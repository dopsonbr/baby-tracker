import { z, ZodError } from "zod"
import {
  applyInputSchema,
  dateSchema,
  interpretInputSchema,
  measurementInputSchema,
  profileInputSchema,
  dateInTimezone,
  type InterpretInput,
  type Snapshot,
  type Proposal,
} from "@workspace/domain"
import { authenticate } from "./auth.js"
import { createDatabase } from "./db.js"
import { ApiError } from "./errors.js"
import { interpret } from "./interpret.js"
import { createRepository, type Repository } from "./repository.js"
interface Dependencies {
  authenticate: (request: Request) => Promise<string>
  repository: Repository
  interpret: (input: InterpretInput, state: Snapshot) => Promise<Proposal>
}
const response = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new ApiError(415, "invalid_content_type", "Send this update as JSON.")
  const reader = request.body?.getReader()
  if (!reader) throw new ApiError(400, "invalid_json", "An update is required.")
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 16384) {
      await reader.cancel()
      throw new ApiError(413, "too_large", "This update is too long.")
    }
    chunks.push(value)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch {
    throw new ApiError(400, "invalid_json", "This update could not be read.")
  }
}
export function createHandler(dependencies: Dependencies) {
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url)
      const path = url.pathname.replace(/\/$/, "")
      const actor = await dependencies.authenticate(request)
      const queryDate = url.searchParams.get("date")
      const date = queryDate === null ? undefined : dateSchema.parse(queryDate)
      if (path === "/api/state" && request.method === "GET")
        return response(await dependencies.repository.getState(date))
      if (path === "/api/interpret" && request.method === "POST") {
        const input = interpretInputSchema.parse(await readJson(request))
        const state = await dependencies.repository.getState(input.date)
        if (state.day.version !== input.version)
          throw new ApiError(
            409,
            "stale_version",
            "This day changed. Refresh before interpreting your update again."
          )
        await dependencies.repository.takeInterpretationToken(actor)
        try {
          return response(await dependencies.interpret(input, state))
        } catch (error) {
          if (error instanceof ApiError) throw error
          throw new ApiError(
            502,
            "interpretation_unavailable",
            "We could not interpret that update. Please try again or use a quick entry."
          )
        }
      }
      if (path === "/api/events" && request.method === "POST")
        return response(
          await dependencies.repository.apply(
            applyInputSchema.parse(await readJson(request)),
            actor
          )
        )
      if (path === "/api/profile" && request.method === "PATCH") {
        const input = profileInputSchema.parse(await readJson(request))
        if (input.birthDate && input.birthDate > dateInTimezone(input.timezone))
          throw new ApiError(
            422,
            "future_birth_date",
            "Choose today or an earlier birth date."
          )
        return response(
          await dependencies.repository.updateProfile(input, date)
        )
      }
      if (path === "/api/measurements" && request.method === "POST")
        return response(
          await dependencies.repository.addMeasurement(
            measurementInputSchema.parse(await readJson(request)),
            actor,
            date
          ),
          201
        )
      if (path === "/api/measurements" && request.method === "PATCH")
        return response(
          await dependencies.repository.updateMeasurement(
            z.string().uuid().parse(url.searchParams.get("id")),
            measurementInputSchema.parse(await readJson(request)),
            date
          )
        )
      if (path === "/api/measurements" && request.method === "DELETE")
        return response(
          await dependencies.repository.deleteMeasurement(
            z.string().uuid().parse(url.searchParams.get("id")),
            date
          )
        )
      return response(
        { error: "This API route does not exist.", code: "not_found" },
        404
      )
    } catch (error) {
      if (error instanceof ZodError)
        return response(
          {
            error:
              error.issues[0]?.message ?? "Check this update and try again.",
            code: "validation_error",
          },
          422
        )
      if (error instanceof ApiError)
        return response(
          { error: error.message, code: error.code },
          error.status
        )
      // Never log transcript, health data, authorization headers, or provider errors.
      console.error("API request failed", {
        name: error instanceof Error ? error.name : "UnknownError",
      })
      return response(
        {
          error: "We could not save or load your day. Please try again.",
          code: "server_error",
        },
        500
      )
    }
  }
}
export const handler = createHandler({
  authenticate,
  repository: createRepository(createDatabase()),
  interpret,
})
