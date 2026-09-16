import { createHash } from "node:crypto"
import { z } from "zod"
import {
  dateSchema,
  eventInputSchema,
  measurementInputSchema,
  profileInputSchema,
} from "@workspace/domain"
import type { Database } from "./db.js"

const legacyKey = z.string().min(1).max(300)
const inputSchema = z
  .object({
    source: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/),
    profile: profileInputSchema,
    days: z
      .array(
        z
          .object({
            date: dateSchema,
            goalOz: z.number().positive().max(100),
            caregiverNote: z.string().max(2000).default(""),
            events: z
              .array(eventInputSchema.safeExtend({ legacyKey }))
              .max(1000),
          })
          .strict()
      )
      .max(10000),
    measurements: z
      .array(measurementInputSchema.safeExtend({ legacyKey }))
      .max(10000),
  })
  .strict()
export type LegacyImportInput = z.input<typeof inputSchema>
export type LegacyImportOptions = {
  target: "development" | "production"
  apply?: boolean
}
const PROFILE_ID = "beckett"

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`)
      .join(",")}}`
  return JSON.stringify(value)
}
export const importHash = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex")
/** UUID v5 with a fixed, application-specific namespace. Key includes source and kind. */
export function legacyUuid(
  source: string,
  kind: "event" | "measurement",
  key: string
): string {
  const namespace = Buffer.from("71bbc774a6b951e3a38c0b7b0c279f55", "hex")
  const bytes = createHash("sha1")
    .update(namespace)
    .update(JSON.stringify([source, kind, key]))
    .digest()
    .subarray(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
const dateText = (value: unknown) =>
  value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10)
export class LegacyImportConflict extends Error {}

export async function importLegacy(
  db: Database,
  raw: unknown,
  options: LegacyImportOptions
) {
  if (options.target !== "development" && options.target !== "production")
    throw new Error("A development or production target label is required.")
  const payload = inputSchema.parse(raw)
  payload.days.sort((a, b) => a.date.localeCompare(b.date))
  for (const day of payload.days)
    day.events.sort((a, b) => a.legacyKey.localeCompare(b.legacyKey))
  payload.measurements.sort((a, b) => a.legacyKey.localeCompare(b.legacyKey))
  const seen = new Set<string>()
  for (const day of payload.days) {
    if (seen.has(`day:${day.date}`)) throw new Error("Duplicate imported day.")
    seen.add(`day:${day.date}`)
    for (const event of day.events) {
      if (seen.has(`event:${event.legacyKey}`))
        throw new Error("Duplicate legacy event key.")
      seen.add(`event:${event.legacyKey}`)
    }
  }
  for (const measurement of payload.measurements) {
    if (seen.has(`measurement:${measurement.legacyKey}`))
      throw new Error("Duplicate legacy measurement key.")
    seen.add(`measurement:${measurement.legacyKey}`)
  }
  const payloadHash = importHash(payload)
  const counts = {
    days: payload.days.length,
    events: payload.days.reduce((n, d) => n + d.events.length, 0),
    measurements: payload.measurements.length,
  }
  return db.transaction(async (sql) => {
    // Matches the live repository's profile lock, preventing concurrent app writes.
    const { rows: profiles } = await sql.query(
      "SELECT * FROM profiles WHERE id=$1 FOR UPDATE",
      [PROFILE_ID]
    )
    if (!profiles[0])
      throw new LegacyImportConflict(
        "Profile is missing; run migrations first."
      )
    const { rows: receipts } = await sql.query(
      "SELECT * FROM legacy_import_receipts WHERE profile_id=$1 AND source=$2",
      [PROFILE_ID, payload.source]
    )
    if (receipts[0]) {
      if (receipts[0].payload_hash !== payloadHash)
        throw new LegacyImportConflict(
          "This source was already imported with a different payload. No changes made."
        )
      if (receipts[0].target !== options.target)
        throw new LegacyImportConflict(
          "Target label differs from the existing receipt."
        )
      return {
        status: "already-imported" as const,
        source: payload.source,
        target: options.target,
        payloadHash,
        counts,
        fillBirthDate: false,
        adoptedEmptyDays: 0,
      }
    }
    const p = profiles[0]
    if (
      p.name !== payload.profile.name ||
      p.sex !== payload.profile.sex ||
      p.timezone !== payload.profile.timezone ||
      Number(p.daily_goal_oz) !== payload.profile.dailyGoalOz ||
      (p.birth_date !== null &&
        dateText(p.birth_date) !== payload.profile.birthDate)
    )
      throw new LegacyImportConflict(
        "Existing profile conflicts with the import. No changes made."
      )
    const fillBirthDate =
      p.birth_date === null && payload.profile.birthDate !== null
    let adoptedEmptyDays = 0
    // Complete preflight before any write; receipts cannot hide partial imports.
    for (const day of payload.days) {
      const { rows } = await sql.query(
        "SELECT d.*, (SELECT count(*) FROM day_events e WHERE e.profile_id=d.profile_id AND e.date=d.date) AS event_count FROM days d WHERE d.profile_id=$1 AND d.date=$2",
        [PROFILE_ID, day.date]
      )
      if (rows[0]) {
        if (
          Number(rows[0].version) !== 0 ||
          Number(rows[0].event_count) !== 0 ||
          rows[0].caregiver_note !== "" ||
          Number(rows[0].goal_oz) !== day.goalOz
        )
          throw new LegacyImportConflict(
            "An existing day conflicts with the import. No changes made."
          )
        adoptedEmptyDays++
      }
      for (const event of day.events) {
        const { rows: collisions } = await sql.query(
          "SELECT id FROM day_events WHERE id=$1",
          [legacyUuid(payload.source, "event", event.legacyKey)]
        )
        if (collisions.length)
          throw new LegacyImportConflict(
            "An event ID exists without an import receipt. No changes made."
          )
      }
    }
    for (const measurement of payload.measurements) {
      const { rows } = await sql.query(
        "SELECT id FROM measurements WHERE id=$1 OR (profile_id=$2 AND date=$3)",
        [
          legacyUuid(payload.source, "measurement", measurement.legacyKey),
          PROFILE_ID,
          measurement.date,
        ]
      )
      if (rows.length)
        throw new LegacyImportConflict(
          "An existing measurement conflicts with the import. No changes made."
        )
    }
    const summary = {
      source: payload.source,
      target: options.target,
      payloadHash,
      counts,
      fillBirthDate,
      adoptedEmptyDays,
    }
    if (!options.apply) return { status: "dry-run" as const, ...summary }
    if (fillBirthDate)
      await sql.query("UPDATE profiles SET birth_date=$1 WHERE id=$2", [
        payload.profile.birthDate,
        PROFILE_ID,
      ])
    await sql.query(
      "INSERT INTO legacy_import_receipts(profile_id,source,payload_hash,target,day_count,event_count,measurement_count) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        PROFILE_ID,
        payload.source,
        payloadHash,
        options.target,
        counts.days,
        counts.events,
        counts.measurements,
      ]
    )
    const record = async (
      kind: string,
      key: string,
      id: string,
      data: unknown
    ) =>
      sql.query(
        "INSERT INTO legacy_import_records(profile_id,source,kind,legacy_key,record_id,record_hash) VALUES($1,$2,$3,$4,$5,$6)",
        [PROFILE_ID, payload.source, kind, key, id, importHash(data)]
      )
    const actor = `legacy-import:${payload.source}`
    for (const day of payload.days) {
      await sql.query(
        "INSERT INTO days(profile_id,date,goal_oz,caregiver_note) VALUES($1,$2,$3,$4) ON CONFLICT(profile_id,date) DO UPDATE SET caregiver_note=EXCLUDED.caregiver_note",
        [PROFILE_ID, day.date, day.goalOz, day.caregiverNote]
      )
      await record("day", day.date, day.date, day)
      for (const event of day.events) {
        const id = legacyUuid(payload.source, "event", event.legacyKey)
        await sql.query(
          "INSERT INTO day_events(id,profile_id,date,type,time,end_time,amount_oz,note,status,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)",
          [
            id,
            PROFILE_ID,
            day.date,
            event.type,
            event.time,
            event.endTime,
            event.amountOz,
            event.note,
            event.status,
            actor,
          ]
        )
        await record("event", event.legacyKey, id, event)
      }
      // Invalidate any stale empty-day client snapshot following adoption/import.
      await sql.query(
        "UPDATE days SET version=version+1 WHERE profile_id=$1 AND date=$2",
        [PROFILE_ID, day.date]
      )
    }
    for (const m of payload.measurements) {
      const id = legacyUuid(payload.source, "measurement", m.legacyKey)
      await sql.query(
        "INSERT INTO measurements(id,profile_id,date,weight_kg,length_cm,head_cm,source,note,needs_review,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          id,
          PROFILE_ID,
          m.date,
          m.weightKg,
          m.lengthCm,
          m.headCm,
          m.source,
          m.note,
          m.needsReview,
          actor,
        ]
      )
      await record("measurement", m.legacyKey, id, m)
    }
    return { status: "imported" as const, ...summary }
  })
}
