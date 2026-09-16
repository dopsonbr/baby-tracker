import { test, before, after, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { PGlite } from "@electric-sql/pglite"
import {
  importLegacy,
  legacyUuid,
  type LegacyImportInput,
} from "../src/import-legacy.js"
import { createRepository } from "../src/repository.js"
import type { Database } from "../src/db.js"
const pg = new PGlite()
const db: Database = {
  transaction: (work) =>
    pg.transaction((tx) =>
      work({ query: async (sql, values) => tx.query(sql, values) })
    ),
}
const fixture = (): LegacyImportInput => ({
  source: "synthetic-import-v1",
  profile: {
    name: "Sample Baby",
    birthDate: "2026-01-01",
    sex: "female",
    timezone: "UTC",
    dailyGoalOz: 28,
  },
  days: [
    {
      date: "2026-02-01",
      goalOz: 24,
      caregiverNote: "Synthetic caregiver instruction",
      events: [
        {
          legacyKey: "feed-one",
          type: "feed",
          time: "08:00",
          endTime: null,
          amountOz: 3.5,
          note: "Synthetic bottle",
          status: "completed",
        },
        {
          legacyKey: "sleep-one",
          type: "sleep",
          time: "23:00",
          endTime: "01:00",
          amountOz: null,
          note: "",
          status: "planned",
        },
      ],
    },
    { date: "2026-02-02", goalOz: 27, events: [] },
  ],
  measurements: [
    {
      legacyKey: "visit-one",
      date: "2026-02-01",
      weightKg: 4.123,
      lengthCm: 52.34,
      headCm: 34.5,
      source: "Synthetic clinic",
      note: "Verify original unit",
      needsReview: true,
    },
  ],
})
before(async () => {
  for (const file of [
    "001_initial.sql",
    "002_feed_amount_required.sql",
    "003_ai_rate_limits.sql",
    "004_legacy_import.sql",
  ])
    await pg.exec(
      await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8")
    )
})
after(() => pg.close())
beforeEach(async () => {
  await pg.exec(
    "TRUNCATE legacy_import_records,legacy_import_receipts,mutation_receipts,measurements,day_events,days,goal_history; UPDATE profiles SET name='Sample Baby',birth_date=NULL,sex='female',timezone='UTC',daily_goal_oz=28; INSERT INTO goal_history(profile_id,effective_date,goal_oz) VALUES('beckett','0001-01-01',28)"
  )
})
const count = async (table: string) =>
  Number(
    (
      await pg.query<{ count: number }>(
        `SELECT count(*) AS count FROM ${table}`
      )
    ).rows[0]!.count
  )

test("dry-run returns a reviewable hash and counts without inserting anything", async () => {
  const result = await importLegacy(db, fixture(), { target: "development" })
  assert.equal(result.status, "dry-run")
  assert.deepEqual(result.counts, { days: 2, events: 2, measurements: 1 })
  assert.equal(result.payloadHash.length, 64)
  assert.equal(result.fillBirthDate, true)
  for (const table of [
    "days",
    "day_events",
    "measurements",
    "legacy_import_receipts",
    "legacy_import_records",
  ])
    assert.equal(await count(table), 0)
  assert.equal(
    (await pg.query<Record<string, unknown>>("SELECT birth_date FROM profiles"))
      .rows[0]!.birth_date,
    null
  )
})
test("apply preserves goals, overnight sleep, planned status, notes, review flags and provenance", async () => {
  const input = fixture()
  const result = await importLegacy(db, input, {
    target: "development",
    apply: true,
  })
  assert.equal(result.status, "imported")
  const snapshot = await createRepository(db).getState("2026-02-01")
  assert.equal(snapshot.profile.birthDate, "2026-01-01")
  assert.equal(snapshot.day.goalOz, 24)
  assert.equal(snapshot.day.caregiverNote, "Synthetic caregiver instruction")
  assert.equal(snapshot.day.events[0]!.amountOz, 3.5)
  assert.equal(snapshot.day.events[1]!.endTime, "01:00")
  assert.equal(snapshot.day.events[1]!.status, "planned")
  assert.equal(snapshot.measurements[0]!.weightKg, 4.123)
  assert.equal(snapshot.measurements[0]!.needsReview, true)
  assert.equal(snapshot.measurements[0]!.headCm, 34.5)
  assert.equal(snapshot.measurements[0]!.source, "Synthetic clinic")
  assert.equal(snapshot.measurements[0]!.note, "Verify original unit")
  assert.equal(
    snapshot.history.find((day) => day.date === "2026-02-02")!.goalOz,
    27
  )
  assert.equal(await count("legacy_import_records"), 5)
  assert.equal(
    (
      await pg.query<Record<string, unknown>>(
        "SELECT payload_hash FROM legacy_import_receipts"
      )
    ).rows[0]!.payload_hash,
    result.payloadHash
  )
})
test("replay preserves later edits and deletes; reordered identical input has the same receipt", async () => {
  const input = fixture()
  const first = await importLegacy(db, input, {
    target: "development",
    apply: true,
  })
  await pg.exec(
    "UPDATE profiles SET name='Edited later'; UPDATE days SET caregiver_note='Edited later',version=9; UPDATE day_events SET amount_oz=4 WHERE type='feed'; DELETE FROM measurements"
  )
  input.days.reverse()
  input.days[1]!.events.reverse()
  const repeated = await importLegacy(db, input, {
    target: "development",
    apply: true,
  })
  assert.equal(repeated.status, "already-imported")
  assert.equal(repeated.payloadHash, first.payloadHash)
  assert.equal(await count("measurements"), 0)
  assert.equal(
    Number(
      (
        await pg.query<Record<string, unknown>>(
          "SELECT amount_oz FROM day_events WHERE type='feed'"
        )
      ).rows[0]!.amount_oz
    ),
    4
  )
  assert.equal(
    (await pg.query<Record<string, unknown>>("SELECT name FROM profiles"))
      .rows[0]!.name,
    "Edited later"
  )
  assert.equal(await count("legacy_import_receipts"), 1)
})
test("same source with changed contents is rejected even after a complete import", async () => {
  const input = fixture()
  await importLegacy(db, input, { target: "production", apply: true })
  input.measurements[0]!.needsReview = false
  await assert.rejects(
    importLegacy(db, input, { target: "production", apply: true }),
    /different payload/
  )
  await assert.rejects(
    importLegacy(db, fixture(), { target: "development", apply: true }),
    /Target label/
  )
  assert.equal(
    (
      await pg.query<Record<string, unknown>>(
        "SELECT needs_review FROM measurements"
      )
    ).rows[0]!.needs_review,
    true
  )
})
test("profile, occupied day, differing goal and existing measurement conflicts make no partial writes", async () => {
  await pg.exec("UPDATE profiles SET birth_date='2025-12-31'")
  await assert.rejects(
    importLegacy(db, fixture(), { target: "development", apply: true }),
    /profile conflicts/
  )
  await pg.exec(
    "UPDATE profiles SET birth_date=NULL; INSERT INTO days(profile_id,date,goal_oz,version) VALUES('beckett','2026-02-02',27,1)"
  )
  await assert.rejects(
    importLegacy(db, fixture(), { target: "development", apply: true }),
    /existing day conflicts/
  )
  assert.equal(await count("days"), 1)
  await pg.exec("UPDATE days SET version=0,goal_oz=28")
  await assert.rejects(
    importLegacy(db, fixture(), { target: "development", apply: true }),
    /existing day conflicts/
  )
  await pg.exec(
    "DELETE FROM days; INSERT INTO measurements(id,profile_id,date,weight_kg,created_by) VALUES('00000000-0000-4000-8000-000000000001','beckett','2026-02-01',4,'live-user')"
  )
  await assert.rejects(
    importLegacy(db, fixture(), { target: "development", apply: true }),
    /existing measurement conflicts/
  )
  assert.equal(await count("days"), 0)
  assert.equal(await count("legacy_import_receipts"), 0)
  assert.equal(
    (await pg.query<Record<string, unknown>>("SELECT birth_date FROM profiles"))
      .rows[0]!.birth_date,
    null
  )
})
test("matching untouched empty days can be adopted and their version is invalidated", async () => {
  await pg.exec(
    "INSERT INTO days(profile_id,date,goal_oz) VALUES('beckett','2026-02-01',24)"
  )
  const result = await importLegacy(db, fixture(), {
    target: "development",
    apply: true,
  })
  assert.equal(result.adoptedEmptyDays, 1)
  assert.equal(await count("days"), 2)
  assert.equal(
    Number(
      (
        await pg.query<Record<string, unknown>>(
          "SELECT version FROM days WHERE date='2026-02-01'"
        )
      ).rows[0]!.version
    ),
    1
  )
})
test("a database failure after writes rolls back the entire import, including profile and receipt", async () => {
  const failing: Database = {
    transaction: (work) =>
      pg.transaction((tx) =>
        work({
          query: async (sql, values) => {
            if (sql.startsWith("INSERT INTO measurements"))
              throw new Error("Synthetic injected write failure")
            return tx.query(sql, values)
          },
        })
      ),
  }
  await assert.rejects(
    importLegacy(failing, fixture(), { target: "development", apply: true }),
    /injected write failure/
  )
  for (const table of [
    "days",
    "day_events",
    "measurements",
    "legacy_import_receipts",
    "legacy_import_records",
  ])
    assert.equal(await count(table), 0)
  assert.equal(
    (await pg.query<Record<string, unknown>>("SELECT birth_date FROM profiles"))
      .rows[0]!.birth_date,
    null
  )
})
test("duplicate legacy keys and malformed measurements are rejected before writes", async () => {
  const input = fixture()
  input.days[0]!.events.push({ ...input.days[0]!.events[0]! })
  await assert.rejects(
    importLegacy(db, input, { target: "development", apply: true }),
    /Duplicate legacy event key/
  )
  const invalid = fixture()
  invalid.measurements[0]!.weightKg = -1
  await assert.rejects(
    importLegacy(db, invalid, { target: "development", apply: true })
  )
  assert.equal(await count("legacy_import_receipts"), 0)
})
test("IDs are stable and namespaced by source, record kind and unambiguous key", () => {
  assert.equal(
    legacyUuid("source", "event", "a"),
    legacyUuid("source", "event", "a")
  )
  assert.notEqual(
    legacyUuid("source", "event", "a"),
    legacyUuid("source", "measurement", "a")
  )
  assert.notEqual(
    legacyUuid("source", "event", "a"),
    legacyUuid("other", "event", "a")
  )
  assert.match(
    legacyUuid("source", "event", "a"),
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  )
})
