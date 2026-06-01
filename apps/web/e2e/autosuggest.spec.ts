import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Auto-suggest E2E. Needs a real reference face photo; we reuse one of the
// OurMonke face crops if present, otherwise skip (the unit/API tests cover the
// logic with mocks).
const ROOT = path.resolve(__dirname, "..", "..", "..");
const PHOTO = path.join(ROOT, "Photos", "Event-MiniGolf-24-04-2026", "raw-pic.jpg");
const MONKE = path.join(ROOT, "MonkeDAO_DAOJones.png");

function findReferenceFace(): string | null {
  const our = path.join(ROOT, "OurMonke");
  if (!fs.existsSync(our)) return null;
  for (const person of fs.readdirSync(our)) {
    const dir = path.join(our, person);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      if (/raw-pic__face_.*\.png$/i.test(f)) return path.join(dir, f);
    }
  }
  return null;
}

test("auto-suggest recognizes a face and fills its monke", async ({ page }, testInfo) => {
  const ref = findReferenceFace();
  test.skip(!ref, "no OurMonke reference face crop available");

  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles(PHOTO);
  await expect(page.locator('button[title^="face #"]').first()).toBeVisible({ timeout: 60_000 });

  // Upload a monke and open the auto-suggest panel.
  await page.locator('input[type="file"]').nth(1).setInputFiles(MONKE);
  await page.getByText(/Auto-suggest — recognize people/).click();

  // Define one person: name, pick the monke, upload the reference face crop.
  await page.getByPlaceholder("Person name").fill("Tester");
  await page.locator("select").selectOption({ index: 1 });
  await page
    .locator('input[type="file"]')
    .last()
    .setInputFiles(ref as string);

  // Person row should show it enrolled (usable refs >= 1).
  await expect(page.getByText(/usable reference photo/)).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: testInfo.outputPath("a1-person-added.png"), fullPage: true });

  // Run auto-suggest; expect a "Matched N of M" message.
  await page.getByRole("button", { name: "✨ Auto-suggest" }).click();
  await expect(page.getByText(/Matched \d+ of \d+ faces/)).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: testInfo.outputPath("a2-suggested.png"), fullPage: true });

  // If anything was unmatched, fill with DAOJones.
  const generic = page.getByRole("button", { name: /Use DAOJones for the/ });
  if (await generic.isVisible().catch(() => false)) {
    await generic.click();
  }

  // Generate. If faces remain unassigned, the modal appears — cover them.
  await page.getByRole("button", { name: /Generate/ }).click();
  const cover = page.getByRole("button", { name: /Cover with DAOJones/ });
  if (await cover.isVisible({ timeout: 3000 }).catch(() => false)) {
    await cover.click();
  }
  await expect(page.locator('img[alt="result"]')).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: testInfo.outputPath("a3-result.png"), fullPage: true });
});
