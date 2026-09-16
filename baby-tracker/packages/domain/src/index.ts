import { z } from "zod"

export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`)
    return (
      value.slice(0, 4) !== "0000" &&
      !Number.isNaN(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    )
  }, "Choose a valid calendar date")
export const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time in HH:mm format")
export const timezoneSchema = z
  .string()
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value })
      return true
    } catch {
      return false
    }
  }, "Choose a valid timezone")
export const profileInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    birthDate: dateSchema.nullable(),
    sex: z.enum(["male", "female"]),
    timezone: timezoneSchema,
    dailyGoalOz: z.number().finite().min(0.01).max(100),
  })
  .strict()
export const profileSchema = profileInputSchema.extend({ id: z.string() })
export const eventInputSchema = z
  .object({
    type: z.enum(["feed", "sleep", "note"]),
    time: timeSchema,
    endTime: timeSchema.nullable(),
    amountOz: z.number().finite().min(0.01).max(32).nullable(),
    note: z.string().trim().max(1000),
    status: z.enum(["completed", "planned"]),
  })
  .strict()
  .superRefine((event, ctx) => {
    if (event.type === "feed" && event.amountOz === null)
      ctx.addIssue({
        code: "custom",
        path: ["amountOz"],
        message: "A feed needs an amount",
      })
    if (event.type !== "feed" && event.amountOz !== null)
      ctx.addIssue({
        code: "custom",
        path: ["amountOz"],
        message: "Only feeds have an amount",
      })
    if (event.type !== "sleep" && event.endTime !== null)
      ctx.addIssue({
        code: "custom",
        path: ["endTime"],
        message: "Only sleep has an end time",
      })
    if (event.type === "sleep" && event.endTime === event.time)
      ctx.addIssue({
        code: "custom",
        path: ["endTime"],
        message: "Sleep start and end must differ",
      })
    if (event.type === "note" && !event.note)
      ctx.addIssue({
        code: "custom",
        path: ["note"],
        message: "A note needs text",
      })
  })
export const eventSchema = eventInputSchema.safeExtend({ id: z.string() })
export const operationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), event: eventInputSchema }).strict(),
  z
    .object({
      action: z.literal("update"),
      id: z.string().uuid(),
      event: eventInputSchema,
    })
    .strict(),
  z.object({ action: z.literal("delete"), id: z.string().uuid() }).strict(),
])
export const proposalSchema = z
  .object({
    summary: z.string().min(1).max(1500),
    questions: z.array(z.string().max(500)).max(5),
    operations: z.array(operationSchema).max(20),
  })
  .strict()
export const daySchema = z.object({
  date: dateSchema,
  goalOz: z.number(),
  version: z.number().int().nonnegative(),
  events: z.array(eventSchema),
})
export const measurementInputSchema = z
  .object({
    date: dateSchema,
    weightKg: z.number().finite().min(0.001).max(100).nullable(),
    lengthCm: z.number().finite().min(0.01).max(200).nullable(),
    headCm: z.number().finite().min(0.01).max(100).nullable().default(null),
    source: z.string().trim().max(200).default(""),
    note: z.string().trim().max(1000).default(""),
    needsReview: z.boolean().default(false),
  })
  .strict()
  .refine(
    (m) => m.weightKg !== null || m.lengthCm !== null || m.headCm !== null,
    "Enter weight, length, or head circumference"
  )
export const measurementSchema = measurementInputSchema.safeExtend({
  id: z.string(),
})
export const snapshotSchema = z.object({
  profile: profileSchema,
  day: daySchema,
  measurements: z.array(measurementSchema),
  history: z.array(daySchema),
})
export const interpretInputSchema = z
  .object({
    date: dateSchema,
    text: z.string().trim().min(1).max(3000),
    version: z.number().int().nonnegative(),
  })
  .strict()
export const applyInputSchema = z
  .object({
    date: dateSchema,
    version: z.number().int().nonnegative(),
    requestId: z.string().uuid(),
    operations: z.array(operationSchema).min(1).max(20),
  })
  .strict()
export type Profile = z.infer<typeof profileSchema>
export type DayEvent = z.infer<typeof eventSchema>
export type EventInput = z.infer<typeof eventInputSchema>
export type Day = z.infer<typeof daySchema>
export type Measurement = z.infer<typeof measurementSchema>
export type Snapshot = z.infer<typeof snapshotSchema>
export type Proposal = z.infer<typeof proposalSchema>
export type Operation = z.infer<typeof operationSchema>
export type ApplyInput = z.infer<typeof applyInputSchema>
export type InterpretInput = z.infer<typeof interpretInputSchema>
export type ProfileInput = z.infer<typeof profileInputSchema>
export type MeasurementInput = z.input<typeof measurementInputSchema>

export function dateInTimezone(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
}
export function totalOunces(events: DayEvent[]): number {
  return (
    Math.round(
      events.reduce(
        (total, e) =>
          total +
          (e.type === "feed" && e.status === "completed"
            ? (e.amountOz ?? 0)
            : 0),
        0
      ) * 100
    ) / 100
  )
}
/** Sleep is anchored to its start date; an earlier end clock means the next day. */
export function sleepMinutes(
  event: Pick<DayEvent, "time" | "endTime">
): number | null {
  if (!event.endTime) return null
  const minutes = (time: string) =>
    Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
  const difference = minutes(event.endTime) - minutes(event.time)
  return difference < 0 ? difference + 1440 : difference
}
/** Corrections must target a current event, once per batch. No partial application. */
export function applyOperations(
  events: DayEvent[],
  operations: Operation[],
  createId: () => string
): DayEvent[] {
  const next = [...events]
  const targets = new Set<string>()
  for (const operation of operations) {
    operationSchema.parse(operation)
    if (operation.action === "add") {
      next.push({ ...operation.event, id: createId() })
      continue
    }
    if (targets.has(operation.id))
      throw new Error("An event can only be changed once per update")
    targets.add(operation.id)
    const index = next.findIndex((event) => event.id === operation.id)
    if (index < 0 || !events.some((event) => event.id === operation.id))
      throw new Error("That event no longer exists on this day")
    if (operation.action === "delete") next.splice(index, 1)
    else next[index] = { ...operation.event, id: operation.id }
  }
  return next.sort(
    (a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id)
  )
}
