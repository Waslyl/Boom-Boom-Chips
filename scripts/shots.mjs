/**
 * Capture the game's screens for visual review.
 * Usage: node scripts/shots.mjs [outDir]
 */
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] ?? 'screenshots';
const BASE = process.env.BBC_URL ?? 'http://127.0.0.1:8099';
mkdirSync(OUT, { recursive: true });

const CHIP = 'button.chip';

async function shoot(page, name) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log('  •', name);
}

async function plantBombs(page) {
  const chips = page.getByRole('grid', { name: /choose three chips/i }).locator(CHIP);
  for (const i of [0, 4, 8]) await chips.nth(i).click();
}

async function run(label, contextOptions) {
  const browser = await chromium.launch();
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  console.log(`\n${label}:`);

  await page.goto(BASE);
  await page.waitForTimeout(1_400);
  await shoot(page, `${label}-01-menu`);

  await page.getByRole('button', { name: /how to play/i }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /^next$/i }).click();
  await shoot(page, `${label}-02-tutorial`);
  await page.getByLabel('Back').click();

  await page.getByRole('button', { name: /play vs bot/i }).click();
  await shoot(page, `${label}-03-difficulty`);

  await page.getByRole('button', { name: /expert/i }).click();
  await page.waitForTimeout(500);
  await plantBombs(page);
  await shoot(page, `${label}-04-setup`);

  await page.getByRole('button', { name: /^confirm$/i }).click();
  await page.waitForTimeout(900);
  await shoot(page, `${label}-05-game`);

  // Play a few turns so the board shows revealed chips and a live counter.
  for (let turn = 0; turn < 14; turn += 1) {
    if (await page.getByRole('heading', { name: /you (win|lose)/i }).isVisible()) break;
    const clickable = page.locator(`${CHIP}[data-interactive="true"]`);
    if ((await clickable.count()) === 0) {
      await page.waitForTimeout(500);
      continue;
    }
    await clickable.first().click();
    await page.waitForTimeout(200);
    if (turn === 1) await shoot(page, `${label}-06-tension`);
    await page.waitForTimeout(1_200);
    if (turn === 2) await shoot(page, `${label}-07-revealed`);
  }
  await page.waitForTimeout(1_400);
  await shoot(page, `${label}-08-result`);

  await page.getByRole('button', { name: /back to menu/i }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /play with friend/i }).click();
  await page.getByRole('button', { name: /create party/i }).click();
  await page.waitForTimeout(900);
  await shoot(page, `${label}-09-party`);

  await context.close();
  await browser.close();
}

await run('desktop', { viewport: { width: 1440, height: 900 } });
await run('portrait', { ...devices['Pixel 7'] });
await run('landscape', {
  ...devices['Pixel 7'],
  viewport: { width: 932, height: 430 },
  isMobile: true,
  hasTouch: true,
});
console.log(`\nSaved to ${OUT}/`);
