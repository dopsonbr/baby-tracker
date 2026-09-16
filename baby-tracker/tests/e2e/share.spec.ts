import { expect, test } from "@playwright/test"
import { readFile } from "node:fs/promises"

test.beforeEach(async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("LOCAL SAMPLE PREVIEW")).toBeVisible()
})

test("tips default on and can be hidden without removing activity notes", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Open share view" }).click()
  await expect(
    page.getByRole("heading", { name: "Beckett’s Full Day" })
  ).toBeVisible()
  const tips = page.getByRole("checkbox", { name: "Show tips" })
  await expect(tips).toBeChecked()
  await expect(
    page.getByRole("complementary", { name: "Day sheet tips" })
  ).toBeVisible()
  const table = page.getByRole("table")
  await expect(table.getByRole("row")).toHaveCount(9)
  await expect(table).toContainText("A bright and early start")
  await tips.uncheck()
  await expect(
    page.getByRole("complementary", { name: "Day sheet tips" })
  ).toHaveCount(0)
  await expect(table.getByRole("row")).toHaveCount(9)
  await expect(table).toContainText("A bright and early start")
  await expect(page.locator(".paper-so-far")).toContainText("14.5 oz")
  await expect(page.locator(".paper-next")).toContainText("2:15 pm")
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  const sheet = await page.locator(".paper-sheet").boundingBox()
  expect(sheet!.height).toBeLessThan(900)
  await page.screenshot({
    path: "test-results/share-paper-mobile-no-tips.png",
    fullPage: true,
  })
})

test("a complete twenty-event day downloads as a high-resolution PNG", async ({
  page,
}, testInfo) => {
  await page.evaluate(() => {
    const key = "beckett.sample.v2"
    const state = JSON.parse(localStorage.getItem(key)!)
    state.day.caregiverNote = "A family-only caregiver note for the handoff."
    state.day.events = Array.from({ length: 20 }, (_, index) => ({
      id: crypto.randomUUID(),
      type: index % 3 === 0 ? "feed" : index % 3 === 1 ? "sleep" : "note",
      time: `${String(5 + Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}`,
      endTime:
        index % 3 === 1
          ? `${String(6 + Math.floor(index / 2)).padStart(2, "0")}:00`
          : null,
      amountOz: index % 3 === 0 ? 4 : null,
      note:
        index === 2
          ? "Awake / Play (until 07:30) · Open curtains, bright room"
          : index === 5
            ? "Bath · Clean diaper, pajamas"
            : index % 3 === 2
              ? "A lovely little moment with family."
              : "",
      status: index < 10 ? "completed" : "planned",
    }))
    localStorage.setItem(key, JSON.stringify(state))
  })
  await page.reload()
  await page.getByRole("button", { name: "Open share view" }).click()
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(21)
  await expect(page.getByRole("table")).toContainText(
    "Open curtains, bright room"
  )
  await expect(page.getByRole("table")).toContainText("7:30 am")
  await expect(page.locator(".paper-caregiver-note")).toContainText(
    "A family-only caregiver note"
  )
  await page.getByRole("checkbox", { name: "Show tips" }).uncheck()
  await expect(page.locator(".paper-caregiver-note")).toHaveCount(0)
  await expect(page.getByRole("table")).toContainText("Clean diaper, pajamas")
  await page.getByRole("checkbox", { name: "Show tips" }).check()
  const downloadPromise = page.waitForEvent("download")
  await page.getByRole("button", { name: "Save picture", exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(
    /^Beckett-\d{4}-\d{2}-\d{2}\.png$/
  )
  const file = testInfo.outputPath("twenty-event-day.png")
  await download.saveAs(file)
  const bytes = await readFile(file)
  expect(bytes.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  )
  expect(bytes.readUInt32BE(16)).toBe(2000)
  expect(bytes.readUInt32BE(20)).toBeGreaterThan(1500)
  expect(bytes.length).toBeGreaterThan(50_000)
  await expect(page.getByRole("status")).toContainText("Picture ready")
  await expect(page.locator(".paper-image-export")).toHaveCount(0)
})
