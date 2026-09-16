import { expect, test } from "@playwright/test"

test.beforeEach(async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("LOCAL SAMPLE PREVIEW")).toBeVisible()
})

test("a parent records a bottle, edits it, and sees it after reload", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Add manually" }).click()
  const dialog = page.getByRole("dialog", { name: "Add a little moment" })
  await dialog.getByLabel("Time", { exact: true }).fill("09:10")
  await dialog.getByLabel("Amount (oz)").fill("3.5")
  await dialog.getByRole("button", { name: "Save moment" }).click()
  await expect(page.locator(".ounces strong")).toHaveText("18")
  await page.reload()
  await expect(page.locator(".ounces strong")).toHaveText("18")
  await page.getByRole("button", { name: /Edit.*3.5 oz.*9:10/ }).click()
  await page.getByRole("dialog").getByLabel("Amount (oz)").fill("4")
  await page.getByRole("button", { name: "Save changes", exact: true }).click()
  await expect(page.locator(".ounces strong")).toHaveText("18.5")
})

test("planned bottles do not change totals; marking happened does", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Add manually" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("Planned", { exact: true }).check()
  await dialog.getByLabel("Time", { exact: true }).fill("22:15")
  await dialog.getByLabel("Amount (oz)").fill("6")
  await dialog.getByRole("button", { name: "Add to the plan" }).click()
  await expect(page.locator(".ounces strong")).toHaveText("14.5")
  await page.getByRole("button", { name: /Edit.*6 oz.*10:15/ }).click()
  await page.getByRole("dialog").getByLabel("Happened", { exact: true }).check()
  await page.getByRole("button", { name: "Save changes", exact: true }).click()
  await expect(page.locator(".ounces strong")).toHaveText("20.5")
})

test("natural-language input requires review before a change is saved", async ({
  page,
}) => {
  await page
    .getByLabel("Describe an update")
    .fill("Beckett drank 4 oz at 8:15 am")
  await page.getByRole("button", { name: "Review update" }).click()
  await expect(page.getByText("Here’s what I understood")).toBeVisible()
  await expect(page.locator(".ounces strong")).toHaveText("14.5")
  await page.getByRole("button", { name: "Confirm & save" }).click()
  await expect(page.locator(".ounces strong")).toHaveText("18.5")
})

test("overnight sleep counts duration without adding a false waking date", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Add manually" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: "Sleep", exact: true }).click()
  await dialog.getByLabel("Started at").fill("23:00")
  await dialog.getByLabel(/Woke at/).fill("01:00")
  await dialog.getByRole("button", { name: "Save moment" }).click()
  await expect(page.locator(".quick-stats")).toContainText("4h")
  await expect(page.getByText(/\(\+1 day\)/)).toBeVisible()
})

test("changing the goal updates today and preserves historical goals", async ({
  page,
}) => {
  await page.getByRole("button", { name: "History", exact: true }).click()
  const selected = await page.getByLabel("Choose a historical day").inputValue()
  const previous = new Date(`${selected}T12:00:00Z`)
  previous.setUTCDate(previous.getUTCDate() - 1)
  await page
    .getByLabel("Choose a historical day")
    .fill(previous.toISOString().slice(0, 10))
  await expect(page.locator(".ounces")).toContainText("/ 28 oz")
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  await page.getByLabel("Daily feeding goal (oz)").fill("30")
  await page.getByRole("button", { name: "Save settings" }).click()
  await page.getByRole("button", { name: "Today", exact: true }).click()
  await expect(page.locator(".ounces")).toContainText("/ 28 oz")
  await page.getByRole("button", { name: /Back to today/ }).click()
  await expect(page.locator(".ounces")).toContainText("/ 30 oz")
})

test("share surface is compact, readable, and free of app navigation", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Open share view" }).click()
  await expect(
    page.getByRole("heading", { name: "Beckett’s little day" })
  ).toBeVisible()
  await expect(
    page.getByRole("navigation", { name: "Main navigation" })
  ).toHaveCount(0)
  await expect(page.locator(".share-sheet")).toContainText("14.5")
  await expect(page.locator(".share-sheet")).toContainText("STILL TO COME")
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true)
  const sheet = await page.locator(".share-sheet").boundingBox()
  expect(sheet?.height).toBeLessThan(900)
  await page.screenshot({
    path: "test-results/share-mobile.png",
    fullPage: true,
  })
})

test("mobile Today has no horizontal overflow", async ({ page }) => {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true)
  await expect(
    page.getByRole("navigation", { name: "Main navigation" })
  ).toBeVisible()
})
