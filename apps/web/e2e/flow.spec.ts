import { test, expect } from "@playwright/test";
import path from "node:path";

// Repo root is two levels up from apps/web.
const ROOT = path.resolve(__dirname, "..", "..", "..");
const PHOTO = path.join(ROOT, "Photos", "Event-MiniGolf-24-04-2026", "raw-pic.jpg");
const MONKE = path.join(ROOT, "MonkeDAO_DAOJones.png");

test("full flow: upload photo, pair a monke, generate, download", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Monke.*Mask/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("01-landing.png"), fullPage: true });

  // Step 1: upload the event photo (hidden input behind a label).
  await page.locator('input[type="file"]').first().setInputFiles(PHOTO);

  // Faces appear once detection returns.
  const faceButtons = page.locator('button[title^="face #"]');
  await expect(faceButtons.first()).toBeVisible({ timeout: 60_000 });
  const faceCount = await faceButtons.count();
  expect(faceCount).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath("02-faces.png"), fullPage: true });

  // Step 2: upload a monke (the second file input is the monke uploader).
  await page.locator('input[type="file"]').nth(1).setInputFiles(MONKE);
  const monkeThumb = page.locator('button[title*="click to select"], button[title*="assign to face"]');
  await expect(monkeThumb.first()).toBeVisible({ timeout: 30_000 });

  // Select face #0, then click the monke to assign it.
  await page.locator('button[title="face #0"]').click();
  await page.locator('button[title*="assign to face"]').first().click();
  await expect(page.getByText("1/" + faceCount + " done")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("03-paired.png"), fullPage: true });

  // Step 3: generate. Only one face is paired, so the unassigned-faces modal
  // appears — choose "Leave visible".
  await page.getByRole("button", { name: /Generate/ }).click();
  await page.getByRole("button", { name: /Leave visible/ }).click();

  // Live preview: the photo background + at least one draggable monke overlay.
  await expect(page.locator('img[alt="your photo"]')).toBeVisible({ timeout: 60_000 });
  const monke = page.locator('img[alt^="monke for face"]').first();
  await expect(monke).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("04-result.png"), fullPage: true });

  // Nudge face #0 with the arrow and confirm the monke overlay moves instantly
  // (client-side — no server round-trip).
  const beforeNudge = await monke.boundingBox();
  if (!beforeNudge) throw new Error("no monke box");
  await page.locator('button:has-text("▶")').first().click();
  await expect(async () => {
    const b = await monke.boundingBox();
    expect(b!.x).toBeGreaterThan(beforeNudge.x);
  }).toPass({ timeout: 5_000 });
  await page.screenshot({ path: testInfo.outputPath("05-adjusted.png"), fullPage: true });

  // Drag the monke directly on the image and confirm it moves.
  await monke.scrollIntoViewIfNeeded();
  const box = await monke.boundingBox();
  if (!box) throw new Error("no monke box for drag");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 20, { steps: 8 });
  await page.mouse.up();
  await expect(async () => {
    const b = await monke.boundingBox();
    expect(b!.x).toBeGreaterThan(box.x);
  }).toPass({ timeout: 5_000 });
  await page.screenshot({ path: testInfo.outputPath("06-dragged.png"), fullPage: true });

  // Download triggers the single server render and a file download.
  const dlPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download/ }).click();
  const dl = await dlPromise;
  expect(dl.suggestedFilename()).toBe("monkemasked.png");
});

test("pair monke-first then face (reverse order)", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles(PHOTO);
  const faces = page.locator('button[title^="face #"]');
  await expect(faces.first()).toBeVisible({ timeout: 60_000 });
  const faceCount = await faces.count();

  await page.locator('input[type="file"]').nth(1).setInputFiles(MONKE);
  // Click the MONKE first (no face selected yet), then click a face.
  await page.locator('button[title*="click to select"]').first().click();
  await expect(page.getByText(/click a face to assign this monke/)).toBeVisible();
  await page.locator('button[title="face #0"]').click();
  // face #0 should now be assigned -> counter shows 1/N
  await expect(page.getByText("1/" + faceCount + " done")).toBeVisible();
});
