/**
 * Plays one complete multiplayer match between two real browsers and captures
 * both players' end screens. This is the "tested with two clients" check.
 * Usage: node scripts/duel.mjs [outDir]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] ?? 'screenshots';
const BASE = process.env.BBC_URL ?? 'http://127.0.0.1:8099';
mkdirSync(OUT, { recursive: true });

const CHIP = 'button.chip';
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) });

const browser = await chromium.launch();
const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const guestCtx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const host = await hostCtx.newPage();
const guest = await guestCtx.newPage();

async function plantBombs(page, cells) {
  const chips = page.getByRole('grid', { name: /choose three chips/i }).locator(CHIP);
  for (const i of cells) await chips.nth(i).click();
  await page.getByRole('button', { name: /^confirm$/i }).click();
}

console.log('host creates a party…');
await host.goto(BASE);
await host.getByRole('button', { name: /play with friend/i }).click();
await host.getByRole('button', { name: /create party/i }).click();
await host.waitForTimeout(800);
const code = (await host.locator('.code-display').innerText()).replace(/\s/g, '');
console.log('  code:', code);

console.log('guest joins…');
await guest.goto(BASE);
await guest.getByRole('button', { name: /play with friend/i }).click();
await guest.getByRole('button', { name: /join party/i }).click();
await guest.getByLabel(/party code/i).fill(code);
await guest.getByRole('button', { name: /^join$/i }).click();
await host.waitForTimeout(700);
await shot(host, 'duel-01-lobby-host');
await shot(guest, 'duel-02-lobby-guest');

console.log('both ready…');
await host.getByRole('button', { name: /^ready$/i }).click();
await guest.getByRole('button', { name: /^ready$/i }).click();
await host.waitForTimeout(700);

console.log('planting bombs in each other plate…');
await plantBombs(host, [0, 1, 2]);
await plantBombs(guest, [6, 7, 8]);
await host.waitForTimeout(900);
await shot(host, 'duel-03-board-host');

console.log('playing…');
for (let turn = 0; turn < 24; turn += 1) {
  const finished = await host.getByRole('heading', { name: /you (win|lose)/i }).isVisible();
  if (finished) break;

  for (const page of [host, guest]) {
    const clickable = page
      .getByRole('grid', { name: /your plate: eat a chip/i })
      .locator(`${CHIP}[data-interactive="true"]`);
    if ((await clickable.count()) === 0) continue;
    // The host walks straight into the guest's traps at 6/7/8 so the match
    // resolves quickly; the guest sticks to chips nobody rigged.
    const targets = page === host ? [6, 7, 8] : [3, 4, 5];
    let clicked = false;
    for (const index of targets) {
      const chip = clickable.nth(0);
      const specific = page
        .getByRole('grid', { name: /your plate: eat a chip/i })
        .locator(CHIP)
        .nth(index);
      if ((await specific.getAttribute('data-interactive')) === 'true') {
        await specific.click();
        clicked = true;
        break;
      }
      void chip;
    }
    if (!clicked) await clickable.first().click();
    await page.waitForTimeout(1_300);
  }
}

await host.waitForTimeout(1_600);
await shot(host, 'duel-04-result-host');
await shot(guest, 'duel-05-result-guest');

const hostHeading = await host.getByRole('heading', { name: /you (win|lose)/i }).innerText();
const guestHeading = await guest.getByRole('heading', { name: /you (win|lose)/i }).innerText();
console.log(`\nhost sees:  ${hostHeading}`);
console.log(`guest sees: ${guestHeading}`);
if (hostHeading === guestHeading) {
  console.error('\nFAIL: both players saw the same outcome');
  process.exitCode = 1;
} else {
  console.log('\nOK: exactly one winner, and both screens agree.');
}

console.log('\nrematch…');
await host.getByRole('button', { name: /rematch/i }).click();
await host.waitForTimeout(500);
await shot(host, 'duel-06-rematch-waiting');
await guest.getByRole('button', { name: /rematch/i }).click();
await host.waitForTimeout(900);
const back = await host.getByRole('heading', { name: /rig their chips/i }).isVisible();
console.log(back ? 'OK: rematch started a fresh setup for both.' : 'FAIL: rematch did not restart.');
if (!back) process.exitCode = 1;

await hostCtx.close();
await guestCtx.close();
await browser.close();
console.log(`\nSaved to ${OUT}/`);
