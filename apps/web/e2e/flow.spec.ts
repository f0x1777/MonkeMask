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
  const monkeThumb = page.locator('button[title*="assign to face"], button[title="select a face first"]');
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

  const result = page.locator('img[alt="result"]');
  await expect(result).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: testInfo.outputPath("04-result.png"), fullPage: true });

  // Download link is present and points at a blob.
  const dl = page.getByRole("link", { name: /Download/ });
  await expect(dl).toBeVisible();
  expect(await dl.getAttribute("href")).toMatch(/^blob:/);

  // Adjust panel is open by default; nudge face #0 with the arrow and confirm the
  // result image changes.
  const beforeNudge = await result.getAttribute("src");
  await page.locator('button:has-text("▶")').first().click();
  await expect(async () => {
    expect(await result.getAttribute("src")).not.toBe(beforeNudge);
  }).toPass({ timeout: 30_000 });
  await page.screenshot({ path: testInfo.outputPath("05-adjusted.png"), fullPage: true });

  // Drag with the mouse: pick face #0, then drag across the result image.
  await page.getByRole("button", { name: /^#0/ }).click();
  await expect(page.getByText(/Dragging face #0/)).toBeVisible();
  const beforeDrag = await result.getAttribute("src");
  // page.mouse uses viewport coords — scroll the image in so boundingBox is on-screen.
  await result.scrollIntoViewIfNeeded();
  const box = await result.boundingBox();
  if (!box) throw new Error("no result image box");
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await expect(async () => {
    expect(await result.getAttribute("src")).not.toBe(beforeDrag);
  }).toPass({ timeout: 30_000 });
  await page.screenshot({ path: testInfo.outputPath("06-dragged.png"), fullPage: true });
});
