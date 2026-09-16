/** Explicit opt-in only. Point DATABASE_URL at a disposable development branch. */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { createDatabase } from "../src/db.js"
import { createRepository } from "../src/repository.js"
if (process.env.CONFIRM_TEST_DATABASE !== "development")
  throw new Error(
    "Set CONFIRM_TEST_DATABASE=development and load a dedicated Neon test branch env file."
  )
const database = createDatabase()
const repository = createRepository(database)
const date = "1999-11-03"
const actor = `integration_${randomUUID()}`
const requestId = randomUUID()
const exists = await database.transaction((sql) =>
  sql.query("SELECT date FROM days WHERE profile_id=$1 AND date=$2", [
    "beckett",
    date,
  ])
)
assert.equal(
  exists.rows.length,
  0,
  "Reserved integration test day already exists; refusing to modify it"
)
try {
  const empty = await repository.getState(date)
  const input = {
    date,
    version: empty.day.version,
    requestId,
    operations: [
      {
        action: "add" as const,
        event: {
          type: "feed" as const,
          time: "08:15",
          endTime: null,
          amountOz: 5,
          note: "Integration test",
          status: "completed" as const,
        },
      },
    ],
  }
  const first = await repository.apply(input, actor)
  assert.equal(first.day.events.length, 1)
  assert.equal((await repository.apply(input, actor)).day.events.length, 1)
  await assert.rejects(
    repository.apply({ ...input, requestId: randomUUID() }, actor)
  )
  const id = first.day.events[0]!.id
  const corrected = await repository.apply(
    {
      date,
      version: 1,
      requestId: randomUUID(),
      operations: [
        {
          action: "update",
          id,
          event: { ...input.operations[0]!.event, amountOz: 4 },
        },
      ],
    },
    actor
  )
  assert.equal(corrected.day.events[0]!.amountOz, 4)
  const read = await repository.getState(date)
  assert.equal(read.day.version, 2)
  assert.equal(read.day.events[0]!.id, id)
  console.log(
    "Neon integration passed: migration, durable round-trip, replay deduplication, correction identity, stale-version rejection."
  )
} finally {
  await database.transaction(async (sql) => {
    await sql.query("DELETE FROM day_events WHERE profile_id=$1 AND date=$2", [
      "beckett",
      date,
    ])
    await sql.query("DELETE FROM days WHERE profile_id=$1 AND date=$2", [
      "beckett",
      date,
    ])
    await sql.query("DELETE FROM mutation_receipts WHERE actor_id=$1", [actor])
  })
  console.log("Integration test records removed from the development branch.")
}
