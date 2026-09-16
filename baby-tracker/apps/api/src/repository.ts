import { createHash, randomUUID } from "node:crypto"
import {
  applyOperations,
  dateInTimezone,
  type ApplyInput,
  type Day,
  type DayEvent,
  type MeasurementInput,
  type Profile,
  type ProfileInput,
  type Snapshot,
} from "@workspace/domain"
import type { Database, SqlClient } from "./db.js"
import { ApiError } from "./errors.js"
const PROFILE_ID = "beckett"
const dateText = (value: unknown): string =>
  value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10)
const eventFromRow = (row: Record<string, unknown>): DayEvent => ({
  id: String(row.id),
  type: row.type as DayEvent["type"],
  time: String(row.time).slice(0, 5),
  endTime: row.end_time === null ? null : String(row.end_time).slice(0, 5),
  amountOz: row.amount_oz === null ? null : Number(row.amount_oz),
  note: String(row.note),
  status: row.status as DayEvent["status"],
})
async function profile(sql: SqlClient): Promise<Profile> {
  // All requests lock the one family profile, serializing idempotency and snapshots.
  const { rows } = await sql.query(
    "SELECT * FROM profiles WHERE id=$1 FOR UPDATE",
    [PROFILE_ID]
  )
  const row = rows[0]
  if (!row)
    throw new ApiError(
      503,
      "migration_required",
      "Run the database migration to finish setup."
    )
  return {
    id: PROFILE_ID,
    name: String(row.name),
    birthDate: row.birth_date ? dateText(row.birth_date) : null,
    sex: row.sex as Profile["sex"],
    timezone: String(row.timezone),
    dailyGoalOz: Number(row.daily_goal_oz),
  }
}
async function ensureDay(sql: SqlClient, date: string) {
  await sql.query(
    `INSERT INTO days(profile_id,date,goal_oz) SELECT $1,$2,goal_oz FROM goal_history WHERE profile_id=$1 AND effective_date <= $2 ORDER BY effective_date DESC LIMIT 1 ON CONFLICT DO NOTHING`,
    [PROFILE_ID, date]
  )
}
async function readDay(sql: SqlClient, date: string): Promise<Day> {
  const { rows } = await sql.query(
    "SELECT * FROM days WHERE profile_id=$1 AND date=$2",
    [PROFILE_ID, date]
  )
  const { rows: events } = await sql.query(
    "SELECT * FROM day_events WHERE profile_id=$1 AND date=$2 ORDER BY time,id",
    [PROFILE_ID, date]
  )
  return {
    date,
    goalOz: Number(rows[0]!.goal_oz),
    version: Number(rows[0]!.version),
    caregiverNote: String(rows[0]!.caregiver_note ?? ""),
    events: events.map(eventFromRow),
  }
}
async function snapshot(
  sql: SqlClient,
  p: Profile,
  date: string
): Promise<Snapshot> {
  await ensureDay(sql, date)
  const { rows: dayRows } = await sql.query(
    "SELECT * FROM days WHERE profile_id=$1 ORDER BY date DESC LIMIT 366",
    [PROFILE_ID]
  )
  const { rows: events } = await sql.query(
    "SELECT e.* FROM day_events e JOIN (SELECT date FROM days WHERE profile_id=$1 ORDER BY date DESC LIMIT 366) d ON d.date=e.date WHERE e.profile_id=$1 ORDER BY e.time,e.id",
    [PROFILE_ID]
  )
  const history: Day[] = dayRows.map((d) => ({
    date: dateText(d.date),
    goalOz: Number(d.goal_oz),
    version: Number(d.version),
    caregiverNote: String(d.caregiver_note ?? ""),
    events: events
      .filter((e) => dateText(e.date) === dateText(d.date))
      .map(eventFromRow),
  }))
  const { rows: measurements } = await sql.query(
    "SELECT * FROM measurements WHERE profile_id=$1 ORDER BY date,id",
    [PROFILE_ID]
  )
  return {
    profile: p,
    day: history.find((day) => day.date === date) ?? (await readDay(sql, date)),
    history,
    measurements: measurements.map((m) => ({
      id: String(m.id),
      date: dateText(m.date),
      weightKg: m.weight_kg === null ? null : Number(m.weight_kg),
      lengthCm: m.length_cm === null ? null : Number(m.length_cm),
      headCm: m.head_cm === null ? null : Number(m.head_cm),
      source: String(m.source),
      note: String(m.note),
      needsReview: Boolean(m.needs_review),
    })),
  }
}
export function createRepository(db: Database) {
  return {
    takeInterpretationToken(actor: string) {
      return db.transaction(async (sql) => {
        await sql.query(
          "DELETE FROM ai_rate_limits WHERE bucket < now() - interval '2 days'"
        )
        const { rows } = await sql.query(
          "INSERT INTO ai_rate_limits(actor_id,bucket,count) VALUES($1,date_trunc('minute',now()),1) ON CONFLICT(actor_id,bucket) DO UPDATE SET count=ai_rate_limits.count+1 RETURNING count",
          [actor]
        )
        if (Number(rows[0]!.count) > 20)
          throw new ApiError(
            429,
            "rate_limited",
            "Please wait a minute before another interpreted update. Quick entry is still available."
          )
      })
    },
    getState(date?: string) {
      return db.transaction(async (sql) => {
        const p = await profile(sql)
        return snapshot(sql, p, date ?? dateInTimezone(p.timezone))
      })
    },
    apply(input: ApplyInput, actor: string) {
      return db.transaction(async (sql) => {
        const p = await profile(sql)
        const payloadHash = createHash("sha256")
          .update(JSON.stringify(input))
          .digest("hex")
        const { rows: receipts } = await sql.query(
          "SELECT * FROM mutation_receipts WHERE profile_id=$1 AND request_id=$2",
          [PROFILE_ID, input.requestId]
        )
        if (receipts[0]) {
          if (
            receipts[0].payload_hash !== payloadHash ||
            receipts[0].actor_id !== actor
          )
            throw new ApiError(
              409,
              "idempotency_conflict",
              "This request ID was already used for another update."
            )
          return snapshot(sql, p, input.date)
        }
        await ensureDay(sql, input.date)
        const day = await readDay(sql, input.date)
        if (day.version !== input.version)
          throw new ApiError(
            409,
            "stale_version",
            "This day changed on another device. Refresh and review your update again."
          )
        let next: DayEvent[]
        try {
          next = applyOperations(day.events, input.operations, randomUUID)
        } catch (error) {
          throw new ApiError(
            422,
            "invalid_operation",
            error instanceof Error ? error.message : "Invalid update"
          )
        }
        // Persist only changed events so creation attribution is retained on correction.
        for (const operation of input.operations) {
          if (operation.action === "delete")
            await sql.query(
              "DELETE FROM day_events WHERE id=$1 AND profile_id=$2 AND date=$3",
              [operation.id, PROFILE_ID, input.date]
            )
          if (operation.action === "update") {
            const e = operation.event
            await sql.query(
              "UPDATE day_events SET type=$1,time=$2,end_time=$3,amount_oz=$4,note=$5,status=$6,updated_by=$7,updated_at=now() WHERE id=$8 AND profile_id=$9 AND date=$10",
              [
                e.type,
                e.time,
                e.endTime,
                e.amountOz,
                e.note,
                e.status,
                actor,
                operation.id,
                PROFILE_ID,
                input.date,
              ]
            )
          }
        }
        for (const e of next.filter(
          (e) => !day.events.some((old) => old.id === e.id)
        ))
          await sql.query(
            "INSERT INTO day_events(id,profile_id,date,type,time,end_time,amount_oz,note,status,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)",
            [
              e.id,
              PROFILE_ID,
              input.date,
              e.type,
              e.time,
              e.endTime,
              e.amountOz,
              e.note,
              e.status,
              actor,
            ]
          )
        await sql.query(
          "UPDATE days SET version=version+1 WHERE profile_id=$1 AND date=$2",
          [PROFILE_ID, input.date]
        )
        await sql.query(
          "INSERT INTO mutation_receipts(profile_id,request_id,actor_id,payload_hash) VALUES($1,$2,$3,$4)",
          [PROFILE_ID, input.requestId, actor, payloadHash]
        )
        return snapshot(sql, p, input.date)
      })
    },
    updateProfile(input: ProfileInput, date?: string) {
      return db.transaction(async (sql) => {
        const previous = await profile(sql)
        await sql.query(
          "UPDATE profiles SET name=$1,birth_date=$2,sex=$3,timezone=$4,daily_goal_oz=$5 WHERE id=$6",
          [
            input.name,
            input.birthDate,
            input.sex,
            input.timezone,
            input.dailyGoalOz,
            PROFILE_ID,
          ]
        )
        const today = dateInTimezone(input.timezone)
        await sql.query(
          "INSERT INTO goal_history(profile_id,effective_date,goal_oz) VALUES($1,$2,$3) ON CONFLICT(profile_id,effective_date) DO UPDATE SET goal_oz=excluded.goal_oz",
          [PROFILE_ID, today, input.dailyGoalOz]
        )
        if (input.dailyGoalOz !== previous.dailyGoalOz) {
          // Historical goals are snapshots. Today and future schedules pick up
          // the configured goal and invalidate pending proposals.
          await sql.query(
            "UPDATE days SET goal_oz=$1,version=version+1 WHERE profile_id=$2 AND date>=$3",
            [input.dailyGoalOz, PROFILE_ID, today]
          )
        }
        if (input.timezone !== previous.timezone) {
          await sql.query(
            "UPDATE days SET version=version+1 WHERE profile_id=$1",
            [PROFILE_ID]
          )
        }
        return snapshot(sql, { ...input, id: PROFILE_ID }, date ?? today)
      })
    },
    addMeasurement(input: MeasurementInput, actor: string, date?: string) {
      return db.transaction(async (sql) => {
        const p = await profile(sql)
        if (input.date > dateInTimezone(p.timezone))
          throw new ApiError(
            422,
            "future_measurement",
            "Choose today or an earlier date for a measurement."
          )
        if (p.birthDate && input.date < p.birthDate)
          throw new ApiError(
            422,
            "before_birth",
            "A measurement cannot be before the birth date."
          )
        await sql.query(
          "INSERT INTO measurements(id,profile_id,date,weight_kg,length_cm,head_cm,source,note,needs_review,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [
            randomUUID(),
            PROFILE_ID,
            input.date,
            input.weightKg,
            input.lengthCm,
            input.headCm ?? null,
            input.source ?? "",
            input.note ?? "",
            input.needsReview ?? false,
            actor,
          ]
        )
        return snapshot(sql, p, date ?? dateInTimezone(p.timezone))
      })
    },
    updateMeasurement(id: string, input: MeasurementInput, date?: string) {
      return db.transaction(async (sql) => {
        const p = await profile(sql)
        if (input.date > dateInTimezone(p.timezone))
          throw new ApiError(
            422,
            "future_measurement",
            "Choose today or an earlier date for a measurement."
          )
        if (p.birthDate && input.date < p.birthDate)
          throw new ApiError(
            422,
            "before_birth",
            "A measurement cannot be before the birth date."
          )
        const { rows } = await sql.query(
          "UPDATE measurements SET date=$1,weight_kg=$2,length_cm=$3,head_cm=$4,source=$5,note=$6,needs_review=$7 WHERE id=$8 AND profile_id=$9 RETURNING id",
          [
            input.date,
            input.weightKg,
            input.lengthCm,
            input.headCm ?? null,
            input.source ?? "",
            input.note ?? "",
            input.needsReview ?? false,
            id,
            PROFILE_ID,
          ]
        )
        if (!rows.length)
          throw new ApiError(
            404,
            "not_found",
            "This measurement no longer exists."
          )
        return snapshot(sql, p, date ?? dateInTimezone(p.timezone))
      })
    },
    deleteMeasurement(id: string, date?: string) {
      return db.transaction(async (sql) => {
        const p = await profile(sql)
        await sql.query(
          "DELETE FROM measurements WHERE id=$1 AND profile_id=$2",
          [id, PROFILE_ID]
        )
        return snapshot(sql, p, date ?? dateInTimezone(p.timezone))
      })
    },
  }
}
export type Repository = ReturnType<typeof createRepository>
