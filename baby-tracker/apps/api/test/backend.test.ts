import { test, before, after, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { PGlite } from "@electric-sql/pglite"
import {
  applyInputSchema,
  eventInputSchema,
  dateSchema,
  dateInTimezone,
  sleepMinutes,
  totalOunces,
  type EventInput,
  type Operation,
} from "@workspace/domain"
import { isAllowedGoogleUser, authenticate } from "../src/auth.js"
import { createRepository } from "../src/repository.js"
import { createHandler } from "../src/handler.js"
import { validateProposal } from "../src/interpret.js"
import { ApiError } from "../src/errors.js"
import type { Database } from "../src/db.js"
const pg = new PGlite()
const database: Database = {
  transaction: (work) =>
    pg.transaction((tx) =>
      work({ query: async (sql, values) => tx.query(sql, values) })
    ),
}
const repository = createRepository(database)
const feed: EventInput = {
  type: "feed",
  time: "08:15",
  endTime: null,
  amountOz: 5,
  note: "",
  status: "completed",
}
const apply = (
  operations: Operation[],
  version = 0,
  requestId = randomUUID()
) =>
  repository.apply(
    applyInputSchema.parse({
      date: "2026-09-16",
      version,
      requestId,
      operations,
    }),
    "parent_1"
  )
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
after(async () => {
  await pg.close()
})
beforeEach(async () => {
  await pg.exec(
    "TRUNCATE ai_rate_limits,mutation_receipts,measurements,day_events,days,goal_history; UPDATE profiles SET name='Beckett',birth_date=NULL,sex='male',timezone='America/New_York',daily_goal_oz=28; INSERT INTO goal_history(profile_id,effective_date,goal_oz) VALUES('beckett','0001-01-01',28)"
  )
})
test("validated exact allowlisted verified Google identity only", () => {
  const user = {
    emailAddresses: [
      {
        emailAddress: "Parent@Gmail.com",
        verification: { status: "verified" },
      },
    ],
    externalAccounts: [
      {
        provider: "oauth_google",
        emailAddress: "parent@gmail.com",
        verification: { status: "verified" },
      },
    ],
  }
  assert.equal(isAllowedGoogleUser(user, ["parent@gmail.com"]), true)
  assert.equal(
    isAllowedGoogleUser(
      {
        ...user,
        externalAccounts: [
          { ...user.externalAccounts[0]!, provider: "google" },
        ],
      },
      ["parent@gmail.com"]
    ),
    true
  )
  assert.equal(isAllowedGoogleUser(user, []), false)
  assert.equal(isAllowedGoogleUser(user, ["parent+family@gmail.com"]), false)
  assert.equal(
    isAllowedGoogleUser({ ...user, externalAccounts: [] }, [
      "parent@gmail.com",
    ]),
    false
  )
  assert.equal(
    isAllowedGoogleUser(
      {
        ...user,
        emailAddresses: [
          {
            emailAddress: "parent@gmail.com",
            verification: { status: "unverified" },
          },
        ],
      },
      ["parent@gmail.com"]
    ),
    false
  )
  assert.equal(
    isAllowedGoogleUser(
      {
        ...user,
        externalAccounts: [
          {
            provider: "oauth_google",
            emailAddress: "other@gmail.com",
            verification: { status: "verified" },
          },
        ],
      },
      ["parent@gmail.com"]
    ),
    false
  )
})
test("missing Clerk config fails closed", async () => {
  const previous = process.env.CLERK_SECRET_KEY
  delete process.env.CLERK_SECRET_KEY
  try {
    await assert.rejects(
      authenticate(new Request("http://localhost/api/state")),
      (e: unknown) => e instanceof ApiError && e.status === 503
    )
  } finally {
    if (previous) process.env.CLERK_SECRET_KEY = previous
  }
})
test("invalid dates, clocks, cross-kind data, and missing amounts are rejected", () => {
  for (const value of ["2026-02-30", "2026-13-01", "26-01-01"])
    assert.equal(dateSchema.safeParse(value).success, false)
  for (const value of [
    { ...feed, time: "25:01" },
    { ...feed, amountOz: -2 },
    { ...feed, endTime: "09:00" },
    { ...feed, type: "sleep" },
    { ...feed, amountOz: null },
  ])
    assert.equal(eventInputSchema.safeParse(value).success, false)
  assert.equal(
    eventInputSchema.safeParse({
      ...feed,
      type: "sleep",
      amountOz: null,
      endTime: "09:00",
    }).success,
    true
  )
  assert.equal(sleepMinutes({ time: "23:30", endTime: "01:15" }), 105)
  assert.equal(
    dateInTimezone("America/New_York", new Date("2026-09-16T02:00Z")),
    "2026-09-15"
  )
})
test("multi-event updates persist once; replay cannot duplicate and changed payload conflicts", async () => {
  const requestId = randomUUID()
  const operations: Operation[] = [
    { action: "add", event: feed },
    {
      action: "add",
      event: {
        ...feed,
        type: "sleep",
        time: "09:30",
        endTime: "10:45",
        amountOz: null,
      },
    },
  ]
  const first = await apply(operations, 0, requestId)
  assert.equal(first.day.events.length, 2)
  assert.equal(first.day.version, 1)
  assert.equal(totalOunces(first.day.events), 5)
  const replay = await apply(operations, 0, requestId)
  assert.deepEqual(replay, first)
  await assert.rejects(
    apply([{ action: "add", event: { ...feed, amountOz: 4 } }], 0, requestId),
    (e: unknown) => e instanceof ApiError && e.code === "idempotency_conflict"
  )
  assert.equal((await repository.getState("2026-09-16")).day.events.length, 2)
})
test("correction keeps identity; stale and invalid batches roll back completely", async () => {
  const first = await apply([{ action: "add", event: feed }])
  const id = first.day.events[0]!.id
  const corrected = await apply(
    [{ action: "update", id, event: { ...feed, amountOz: 4 } }],
    1
  )
  assert.equal(corrected.day.events[0]!.id, id)
  assert.equal(corrected.day.events[0]!.amountOz, 4)
  await assert.rejects(
    apply([{ action: "add", event: feed }], 1),
    (e: unknown) => e instanceof ApiError && e.code === "stale_version"
  )
  await assert.rejects(
    apply(
      [
        { action: "add", event: feed },
        { action: "delete", id: randomUUID() },
      ],
      2
    )
  )
  assert.equal((await repository.getState("2026-09-16")).day.events.length, 1)
  assert.equal((await repository.getState("2026-09-16")).day.version, 2)
  const deleted = await apply([{ action: "delete", id }], 2)
  assert.equal(deleted.day.events.length, 0)
})
test("recorded days retain their goal after settings changes; unseen historical days use dated goal history", async () => {
  const old = await repository.getState("2026-09-14")
  assert.equal(old.day.goalOz, 28)
  await repository.updateProfile(
    { ...old.profile, dailyGoalOz: 32 },
    "2026-09-14"
  )
  assert.equal((await repository.getState("2026-09-14")).day.goalOz, 28)
  assert.equal((await repository.getState("2020-01-01")).day.goalOz, 28)
  assert.equal((await repository.getState("2099-01-01")).day.goalOz, 32)
})
test("ambiguous interpretation never returns mutations; unknown correction IDs rejected", async () => {
  const state = await repository.getState("2026-09-16")
  const proposal = validateProposal(
    {
      summary: "Add a feed",
      questions: ["Was that 8:15 AM or PM?"],
      operations: [{ action: "add", event: feed }],
    },
    state
  )
  assert.equal(proposal.operations.length, 0)
  assert.throws(() =>
    validateProposal(
      {
        summary: "Correct feed",
        questions: [],
        operations: [{ action: "update", id: randomUUID(), event: feed }],
      },
      state
    )
  )
  const accepted = validateProposal(
    {
      summary: "5 oz at 8:15 AM",
      questions: [],
      operations: [{ action: "add", event: feed }],
    },
    state
  )
  assert.equal(accepted.operations.length, 1)
  assert.equal((await repository.getState("2026-09-16")).day.events.length, 0)
})
test("measurements preserve source/review metadata and support corrections", async () => {
  const input = {
    date: "2026-01-10",
    weightKg: 4,
    lengthCm: 54,
    headCm: 37,
    source: "Pediatrician",
    note: "Well visit",
    needsReview: true,
  }
  const saved = await repository.addMeasurement(input, "parent_1", "2026-09-16")
  assert.equal(saved.measurements[0]!.headCm, 37)
  assert.equal(saved.measurements[0]!.needsReview, true)
  const edited = await repository.updateMeasurement(
    saved.measurements[0]!.id,
    { ...input, weightKg: 4.2, needsReview: false },
    "2026-09-16"
  )
  assert.equal(edited.measurements[0]!.weightKg, 4.2)
  assert.equal(
    (
      await repository.deleteMeasurement(
        saved.measurements[0]!.id,
        "2026-09-16"
      )
    ).measurements.length,
    0
  )
})
test("API enforces auth before reads and validation before writes", async () => {
  const denied = createHandler({
    authenticate: async () => {
      throw new ApiError(403, "access_denied", "Access denied")
    },
    repository,
    interpret: async () => {
      throw new Error("unused")
    },
  })
  assert.equal(
    (await denied(new Request("http://localhost/api/state"))).status,
    403
  )
  const handler = createHandler({
    authenticate: async () => "parent_1",
    repository,
    interpret: async () => ({
      summary: "Add 5 oz at 8:15 AM",
      questions: [],
      operations: [{ action: "add", event: feed }],
    }),
  })
  const post = (path: string, body: unknown) =>
    handler(
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    )
  assert.equal(
    (
      await post("/api/events", {
        date: "2026-09-16",
        version: 0,
        requestId: randomUUID(),
        operations: [{ action: "add", event: { ...feed, amountOz: -2 } }],
      })
    ).status,
    422
  )
  const proposed = await post("/api/interpret", {
    date: "2026-09-16",
    text: "Beckett drank 5 oz at 8:15 AM",
    version: 0,
  })
  assert.equal(proposed.status, 200)
  assert.equal((await repository.getState("2026-09-16")).day.events.length, 0)
  const body = await proposed.json()
  const applied = await post("/api/events", {
    date: "2026-09-16",
    version: 0,
    requestId: randomUUID(),
    operations: body.operations,
  })
  assert.equal(applied.status, 200)
  assert.equal(
    (
      await post("/api/interpret", {
        date: "2026-09-16",
        text: "One more",
        version: 0,
      })
    ).status,
    409
  )
  assert.equal(
    (
      await handler(new Request("http://localhost/api/state?date=2026-09-16"))
    ).headers.get("cache-control"),
    "private, no-store"
  )
})

test("persisted interpretation throttle stops the 21st request per minute", async () => {
  for (let i = 0; i < 20; i++)
    await repository.takeInterpretationToken("rate_test")
  await assert.rejects(
    repository.takeInterpretationToken("rate_test"),
    (e: unknown) => e instanceof ApiError && e.status === 429
  )
  await repository.takeInterpretationToken("other_parent")
})

test("cross-date corrections and repeated event targets cannot mutate either day", async () => {
  const state = await apply([{ action: "add", event: feed }])
  const id = state.day.events[0]!.id
  await assert.rejects(
    repository.apply(
      {
        date: "2026-09-15",
        version: 0,
        requestId: randomUUID(),
        operations: [{ action: "update", id, event: { ...feed, amountOz: 4 } }],
      },
      "parent_1"
    ),
    (e: unknown) => e instanceof ApiError && e.code === "invalid_operation"
  )
  await assert.rejects(
    apply(
      [
        { action: "update", id, event: { ...feed, amountOz: 4 } },
        { action: "delete", id },
      ],
      1
    )
  )
  assert.equal(
    (await repository.getState("2026-09-16")).day.events[0]!.amountOz,
    5
  )
  assert.equal((await repository.getState("2026-09-15")).day.events.length, 0)
})
test("today and viewed future goals follow settings; historical goals are preserved", async () => {
  const today = dateInTimezone("America/New_York")
  const current = await repository.getState(today)
  const yesterday = new Date(`${today}T12:00:00Z`)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const yesterdayDate = yesterday.toISOString().slice(0, 10)
  await repository.getState(yesterdayDate)
  await repository.getState("2099-01-01")
  await repository.updateProfile({ ...current.profile, dailyGoalOz: 32 }, today)
  assert.equal((await repository.getState(today)).day.goalOz, 32)
  assert.equal((await repository.getState(today)).day.version, 1)
  assert.equal((await repository.getState(yesterdayDate)).day.goalOz, 28)
  const future = await repository.getState("2099-01-01")
  assert.equal(future.day.goalOz, 32)
  assert.equal(future.day.version, 1)
  await repository.updateProfile(
    { ...current.profile, timezone: "Europe/London" },
    today
  )
  await assert.rejects(
    repository.apply(
      {
        date: today,
        version: current.day.version,
        requestId: randomUUID(),
        operations: [{ action: "add", event: feed }],
      },
      "parent_1"
    ),
    (e: unknown) => e instanceof ApiError && e.code === "stale_version"
  )
})
test("invalid PostgreSQL year zero and amounts that round to zero fail application validation", () => {
  assert.equal(dateSchema.safeParse("0000-01-01").success, false)
  assert.equal(
    eventInputSchema.safeParse({ ...feed, amountOz: 0.001 }).success,
    false
  )
})
test("banned or locked users are denied even with verified allowlisted Google accounts", () => {
  const user = {
    emailAddresses: [
      {
        emailAddress: "parent@gmail.com",
        verification: { status: "verified" },
      },
    ],
    externalAccounts: [
      {
        provider: "google",
        emailAddress: "parent@gmail.com",
        verification: { status: "verified" },
      },
    ],
  }
  assert.equal(
    isAllowedGoogleUser({ ...user, banned: true }, ["parent@gmail.com"]),
    false
  )
  assert.equal(
    isAllowedGoogleUser({ ...user, locked: true }, ["parent@gmail.com"]),
    false
  )
})

test("photo validation rejects spoofed format, remote URL, malformed base64, and oversized payloads", async () => {
  const { decodePhoto } = await import("../src/photo.js")
  const { photoInterpretInputSchema, MAX_PHOTO_BYTES } =
    await import("@workspace/domain")
  assert.throws(() =>
    decodePhoto({
      mimeType: "image/png",
      base64: Buffer.from("not an image").toString("base64"),
    })
  )
  assert.throws(() =>
    decodePhoto({
      mimeType: "image/jpeg",
      base64: "https://example.com/image.jpg",
    })
  )
  assert.throws(() => decodePhoto({ mimeType: "image/jpeg", base64: "/9j/!" }))
  assert.throws(
    () =>
      decodePhoto({
        mimeType: "image/jpeg",
        base64: Buffer.alloc(MAX_PHOTO_BYTES + 1).toString("base64"),
      }),
    (error: unknown) => error instanceof ApiError && error.status === 413
  )
  assert.equal(
    photoInterpretInputSchema.safeParse({
      date: "2026-09-16",
      version: 0,
      image: { mimeType: "image/svg+xml", base64: "PHN2Zz4=" },
    }).success,
    false
  )
})
test("board proposals deduplicate existing entries, reject destructive edits and double-counted breakdowns", async () => {
  const { validatePhotoProposal } = await import("../src/photo.js")
  const state = await apply([{ action: "add", event: feed }])
  const exact = validatePhotoProposal(
    {
      summary: "5 oz",
      questions: [],
      operations: [{ action: "add", event: feed }],
    },
    state
  )
  assert.equal(exact.operations.length, 0)
  const conflict = validatePhotoProposal(
    {
      summary: "4 oz",
      questions: [],
      operations: [{ action: "add", event: { ...feed, amountOz: 4 } }],
    },
    state
  )
  assert.ok(conflict.questions.length)
  assert.equal(conflict.operations.length, 0)
  const destructive = validatePhotoProposal(
    {
      summary: "Delete feed",
      questions: [],
      operations: [{ action: "delete", id: state.day.events[0]!.id }],
    },
    state
  )
  assert.equal(destructive.operations.length, 0)
  const empty = { ...state, day: { ...state.day, events: [] } }
  const breakdown = validatePhotoProposal(
    {
      summary: "B2 F3 Total5",
      questions: [],
      operations: [2, 3, 5].map((amountOz) => ({
        action: "add",
        event: { ...feed, amountOz },
      })),
    },
    empty
  )
  assert.equal(breakdown.operations.length, 0)
  assert.ok(breakdown.questions.length)
  const duplicateNotes = validatePhotoProposal(
    {
      summary: "One feed twice",
      questions: [],
      operations: [
        { action: "add", event: feed },
        { action: "add", event: { ...feed, note: "B2 + F3" } },
      ],
    },
    empty
  )
  assert.equal(duplicateNotes.operations.length, 1)
  const nursing = validatePhotoProposal(
    {
      summary: "Nursing volume unclear",
      questions: ["How many measured ounces for N?"],
      operations: [{ action: "add", event: feed }],
    },
    empty
  )
  assert.equal(nursing.operations.length, 0)
})
test("photo API authenticates, checks stale versions, and returns review without writes", async () => {
  let calls = 0
  const { readFile } = await import("node:fs/promises")
  const image = {
    mimeType: "image/png",
    base64: (
      await readFile(
        new URL("../../../tests/fixtures/whiteboard.png", import.meta.url)
      )
    ).toString("base64"),
  }
  const handler = createHandler({
    authenticate: async () => "parent_1",
    repository,
    interpret: async () => {
      throw Error("unused")
    },
    interpretPhoto: async () => {
      calls++
      return {
        summary: "5 oz at 08:15 AM",
        questions: [],
        operations: [{ action: "add", event: feed }],
      }
    },
  })
  const request = (body: unknown) =>
    new Request("http://localhost/api/interpret-photo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  assert.equal(
    (await handler(request({ date: "2026-09-16", version: 1, image }))).status,
    409
  )
  assert.equal(calls, 0)
  const result = await handler(
    request({ date: "2026-09-16", version: 0, image })
  )
  assert.equal(result.status, 200)
  assert.equal(calls, 1)
  assert.equal((await repository.getState("2026-09-16")).day.events.length, 0)
  const denied = createHandler({
    authenticate: async () => {
      throw new ApiError(401, "unauthenticated", "Sign in")
    },
    repository,
    interpret: async () => {
      throw Error("unused")
    },
    interpretPhoto: async () => {
      throw Error("must not call")
    },
  })
  assert.equal(
    (await denied(request({ date: "2026-09-16", version: 0, image }))).status,
    401
  )
})
