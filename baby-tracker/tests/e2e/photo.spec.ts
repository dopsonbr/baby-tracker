import { test, expect } from "@playwright/test"
import path from "node:path"

test("whiteboard photo preview is reviewable and removable on a phone", async ({
  page,
}) => {
  await page.goto("/")
  await expect(
    page.getByRole("button", { name: "Take a photo", exact: true })
  ).toBeVisible()
  const camera = page.getByLabel("Take a whiteboard photo", { exact: true })
  await expect(camera).toHaveAttribute("capture", "environment")
  await page
    .getByLabel("Upload a whiteboard photo", { exact: true })
    .setInputFiles(path.resolve("tests/fixtures/whiteboard.png"))
  await expect(
    page.getByRole("img", { name: "Whiteboard photo to scan" })
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Scan board", exact: true })
  ).toBeDisabled()
  await expect(
    page.getByText(
      "Photo scanning is available in the signed-in app. This sample stays on your device."
    )
  ).toBeVisible()
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth)
  ).toBeLessThanOrEqual(390)
  await page.getByRole("button", { name: "Remove photo" }).click()
  await expect(
    page.getByRole("img", { name: "Whiteboard photo to scan" })
  ).toHaveCount(0)
})

test("non-image upload fails locally without scanning or saving", async ({
  page,
}) => {
  await page.goto("/")
  await page
    .getByLabel("Upload a whiteboard photo", { exact: true })
    .setInputFiles({
      name: "board.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" />'),
    })
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Choose a JPEG, PNG, or WebP photo." })
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Scan board", exact: true })
  ).toHaveCount(0)
})
