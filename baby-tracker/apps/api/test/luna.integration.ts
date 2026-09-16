/** Sends synthetic fixtures only. Run explicitly with Gateway credentials. */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { interpret } from "../src/interpret.js"
import { modelId } from "../src/config.js"
import type { Snapshot } from "@workspace/domain"
const sleepId = randomUUID()
const fixture: Snapshot = {
  profile: {
    id: "synthetic",
    name: "Test child",
    birthDate: null,
    sex: "male",
    timezone: "America/New_York",
    dailyGoalOz: 28,
  },
  day: {
    date: "2026-09-15",
    goalOz: 28,
    version: 0,
    events: [
      {
        id: sleepId,
        type: "sleep",
        time: "09:30",
        endTime: "10:45",
        amountOz: null,
        note: "",
        status: "completed",
      },
    ],
  },
  history: [],
  measurements: [],
}
for (const [text, check] of [
  [
    "The baby drank 5 oz at 8:15 AM.",
    (result: Awaited<ReturnType<typeof interpret>>) => {
      assert.equal(result.questions.length, 0)
      assert.equal(result.operations[0]?.action, "add")
      const op = result.operations[0]!
      assert.ok(op.action === "add")
      assert.equal(op.event.amountOz, 5)
      assert.equal(op.event.time, "08:15")
    },
  ],
  [
    "He actually woke up at 11:20 AM from his 9:30 AM sleep.",
    (result: Awaited<ReturnType<typeof interpret>>) => {
      const op = result.operations[0]!
      assert.equal(result.questions.length, 0)
      assert.equal(op.action, "update")
      assert.ok(op.action === "update")
      assert.equal(op.id, sleepId)
      assert.equal(op.event.endTime, "11:20")
    },
  ],
  [
    "He had some milk earlier.",
    (result: Awaited<ReturnType<typeof interpret>>) => {
      assert.ok(result.questions.length > 0)
      assert.equal(result.operations.length, 0)
    },
  ],
] as const) {
  const result = await interpret(
    { date: fixture.day.date, version: 0, text },
    fixture
  )
  console.log(JSON.stringify(result))
  check(result)
  console.log(`Passed synthetic Luna case: ${text}`)
}
console.log(
  `Live Gateway interpretation verified with ${modelId()}; no database writes.`
)
