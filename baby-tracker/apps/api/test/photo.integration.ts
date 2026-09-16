/** Explicit live vision test. Fixtures contain only invented, labeled test data. */
import { readFile } from "node:fs/promises"
import assert from "node:assert/strict"
import type { Snapshot } from "@workspace/domain"
import { interpretPhoto } from "../src/photo.js"
const state: Snapshot = {
  profile: {
    id: "synthetic",
    name: "Test child",
    birthDate: null,
    sex: "male",
    timezone: "America/New_York",
    dailyGoalOz: 28,
  },
  day: { date: "2026-09-15", goalOz: 28, version: 0, events: [] },
  measurements: [],
  history: [],
}
const image = async (name: string) => ({
  mimeType: "image/png" as const,
  base64: (
    await readFile(
      new URL(`../../../tests/fixtures/${name}.png`, import.meta.url)
    )
  ).toString("base64"),
})
const total = await interpretPhoto(
  {
    date: state.day.date,
    version: 0,
    text: "",
    image: await image("whiteboard"),
  },
  state
)
assert.equal(total.questions.length, 0)
assert.equal(total.operations.length, 1)
assert.equal(total.operations[0]!.action, "add")
assert.ok(total.operations[0]!.action === "add")
assert.equal(total.operations[0]!.event.amountOz, 5)
assert.equal(total.operations[0]!.event.time, "08:15")
console.log(
  "Live vision passed: B2 + F3 + Total5 gives exactly one 5oz feed at08:15."
)
const nursing = await interpretPhoto(
  {
    date: state.day.date,
    version: 0,
    text: "",
    image: await image("whiteboard-nursing"),
  },
  state
)
assert.ok(nursing.questions.length > 0)
assert.equal(nursing.operations.length, 0)
console.log(
  "Live vision passed: nursing without measured volume asks for clarification, no writes."
)
const mismatched = { ...state, day: { ...state.day, date: "2026-09-16" } }
const dateMismatch = await interpretPhoto(
  {
    date: mismatched.day.date,
    version: 0,
    text: "",
    image: await image("whiteboard"),
  },
  mismatched
)
assert.ok(dateMismatch.questions.length > 0)
assert.equal(dateMismatch.operations.length, 0)
console.log(
  "Live vision passed: board date mismatch asks to switch days, no operations."
)
