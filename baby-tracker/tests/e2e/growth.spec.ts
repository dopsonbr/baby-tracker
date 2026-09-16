import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"

async function openGrowthWithBirthday(page: Page) {
  await page.goto("/")
  await expect(page.getByText("LOCAL SAMPLE PREVIEW")).toBeVisible()
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  await page.getByLabel("Date of birth").fill("2026-07-01")
  await page.getByRole("button", { name: "Save settings" }).click()
  await page.getByRole("button", { name: "Growth", exact: true }).click()
}

async function addMeasurement(
  page: Page,
  options: {
    kg?: string
    pounds?: string
    ounces?: string
    review?: boolean
  } = {}
) {
  await page
    .getByRole("button", { name: "Add measurement", exact: true })
    .click()
  const dialog = page.getByRole("dialog", { name: "Add a measurement" })
  await dialog.getByLabel("Measured on").fill("2026-08-01")
  if (options.kg) {
    await dialog.getByLabel("Weight unit").selectOption("kg")
    await dialog.locator("#growth-weight").fill(options.kg)
  } else {
    await dialog.locator("#growth-weight").fill(options.pounds ?? "8")
    await dialog.getByLabel("Weight ounces").fill(options.ounces ?? "8")
  }
  await dialog.locator("#growth-length").fill("21.25")
  await dialog.getByLabel("Head circumference in cm (optional)").fill("36.5")
  await dialog.getByLabel("Source (optional)").fill("Synthetic test visit")
  await dialog
    .getByLabel("Note (optional)")
    .fill("Synthetic measurement for browser verification")
  if (options.review)
    await dialog.getByLabel("Flag this measurement for review").check()
  await dialog
    .getByRole("button", { name: "Save measurement", exact: true })
    .click()
  await expect(dialog).not.toBeVisible()
  await expect(page.locator(".growth-history-row")).toHaveCount(1)
}

async function storedMeasurements(page: Page) {
  return page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("beckett.sample.v2")!)
        .measurements as Array<{
        weightKg: number
        lengthCm: number
        headCm: number
        source: string
        note: string
        needsReview: boolean
      }>
  )
}

test("growth records units, head and source, persists after reload, and respects review flags", async ({
  page,
}) => {
  await openGrowthWithBirthday(page)
  await addMeasurement(page, { review: true })
  const saved = (await storedMeasurements(page))[0]!
  expect(saved.weightKg).toBeCloseTo(3.855535145, 8)
  expect(saved.lengthCm).toBeCloseTo(53.975, 8)
  expect(saved.headCm).toBe(36.5)
  expect(saved.needsReview).toBe(true)
  await expect(page.locator(".growth-history-row")).toContainText(
    "Needs review"
  )
  await expect(page.locator(".growth-stats")).toContainText(
    "No measurements yet"
  )
  await page.reload()
  await page.getByRole("button", { name: "Growth", exact: true }).click()
  await expect(page.locator(".growth-history-row")).toContainText(
    "Synthetic test visit"
  )
  await expect(page.locator(".growth-history-row")).toContainText(
    "Synthetic measurement for browser verification"
  )
  await page.getByRole("button", { name: /Edit measurement from/ }).click()
  const dialog = page.getByRole("dialog", { name: "Edit measurement" })
  await dialog.getByLabel("Flag this measurement for review").uncheck()
  await dialog.getByRole("button", { name: "Save measurement" }).click()
  await expect(page.locator(".growth-stats")).toContainText("8 lb 8 oz")
  await expect(page.locator(".growth-chart")).toHaveCount(1)
  expect((await storedMeasurements(page))[0]!.needsReview).toBe(false)
})

test("editing only notes preserves canonical measurement precision", async ({
  page,
}) => {
  await openGrowthWithBirthday(page)
  await addMeasurement(page, { kg: "3.567" })
  const original = (await storedMeasurements(page))[0]!
  await page.getByRole("button", { name: /Edit measurement from/ }).click()
  const dialog = page.getByRole("dialog", { name: "Edit measurement" })
  await dialog.getByLabel("Note (optional)").fill("Updated synthetic note only")
  await dialog.getByRole("button", { name: "Save measurement" }).click()
  const edited = (await storedMeasurements(page))[0]!
  expect(edited.weightKg).toBe(original.weightKg)
  expect(edited.lengthCm).toBe(original.lengthCm)
  expect(edited.headCm).toBe(original.headCm)
  expect(edited.note).toBe("Updated synthetic note only")
})

test("model sliders change illustrative endpoints and mobile growth has no overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openGrowthWithBirthday(page)
  await addMeasurement(page)
  const cards = await page.locator(".growth-stats").boundingBox()
  expect(cards!.height).toBeLessThan(370)
  await page.screenshot({
    path: "test-results/growth-overview-mobile.png",
    fullPage: true,
  })
  await page.getByRole("button", { name: "Model to 18", exact: true }).click()
  const endpoints = page.locator(".growth-model .growth-insights")
  const original = await endpoints.innerText()
  await page
    .getByRole("slider", { name: "Height target percentile", exact: true })
    .fill("80")
  await page
    .getByRole("slider", { name: "Weight target percentile", exact: true })
    .fill("75")
  await page
    .getByRole("slider", { name: "Curve settles by age", exact: true })
    .fill("10")
  await expect(endpoints).toContainText("80 percentile target")
  await expect(endpoints).toContainText("75 percentile target")
  expect(await endpoints.innerText()).not.toBe(original)
  await expect(page.getByText("age 10", { exact: true })).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true)
  await page.screenshot({
    path: "test-results/growth-model-mobile.png",
    fullPage: true,
  })
  await page.getByRole("button", { name: "Ease toward median" }).click()
  await expect(endpoints).toContainText("50 percentile target")
  expect(await page.locator(".vite-error-overlay").count()).toBe(0)
})
