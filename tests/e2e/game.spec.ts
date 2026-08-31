/**
 * Browser tests against the built game.
 *
 * These drive the real UI with real taps: no test hooks, no injected state, no
 * mocked socket. If a chip is not actually clickable, or a layout collapses at
 * 430px, these fail.
 */
import { expect, test, type Page } from '@playwright/test';

const CHIP = 'button.chip';

async function openMenu(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /boom boom chips/i })).toBeVisible();
}

/** The plate you eat from: the interactive one, and the only one you touch. */
function yourPlate(page: Page) {
  return page.getByRole('grid', { name: /your plate: eat a chip/i });
}

/** Their plate, showing the traps you laid. Never interactive. */
function theirPlate(page: Page) {
  return page.getByRole('grid', { name: /plate, with your bombs/i });
}

function setupGrid(page: Page) {
  return page.getByRole('grid', { name: /choose three chips/i });
}

async function plantBombsManually(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: /rig their chips/i })).toBeVisible();
  const chips = setupGrid(page).locator(CHIP);
  for (const index of [0, 4, 8]) await chips.nth(index).click();
  await expect(page.getByText('3 / 3')).toBeVisible();
  await page.getByRole('button', { name: /^confirm$/i }).click();
}

/** Keep taking turns until the match resolves. */
async function playUntilOver(page: Page, maxTurns = 20): Promise<void> {
  for (let turn = 0; turn < maxTurns; turn += 1) {
    if (await page.getByRole('heading', { name: /you (win|lose)/i }).isVisible()) return;

    const clickable = yourPlate(page).locator(`${CHIP}[data-interactive="true"]`);
    if ((await clickable.count()) === 0) {
      await page.waitForTimeout(600);
      continue;
    }
    await clickable.first().click();
    // Let the tension beat, the flip and the opponent's reply play out.
    await page.waitForTimeout(1_400);
  }
}

test.describe('the shell', () => {
  test('boots, connects, and shows the main menu', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));

    await openMenu(page);
    await expect(page.getByRole('button', { name: /play vs bot/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /play with friend/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /how to play/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /settings/i })).toBeVisible();

    // The socket is live, so nothing should be stuck on "Connecting…".
    await expect(page.getByText(/connecting/i)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('never scrolls sideways', async ({ page }) => {
    await openMenu(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('walks the tutorial', async ({ page }) => {
    await openMenu(page);
    await page.getByRole('button', { name: /how to play/i }).click();
    await expect(page.getByText(/step 1 of 6/i)).toBeVisible();

    await page.getByRole('button', { name: /^next$/i }).click();
    await expect(page.getByText(/step 2 of 6/i)).toBeVisible();
    await expect(page.getByRole('heading', { name: /you rig theirs/i })).toBeVisible();

    await page.getByRole('tab', { name: /step 6/i }).click();
    await expect(page.getByRole('heading', { name: /last one standing wins/i })).toBeVisible();
    await page.getByRole('button', { name: /got it/i }).click();
    await expect(page.getByRole('button', { name: /play vs bot/i })).toBeVisible();
  });

  test('remembers settings across a reload', async ({ page }) => {
    await openMenu(page);
    await page.getByRole('button', { name: /^settings$/i }).click();

    const music = page.getByRole('switch', { name: /music/i });
    await expect(music).toHaveAttribute('aria-checked', 'false');
    await music.click();
    await expect(music).toHaveAttribute('aria-checked', 'true');

    await page.reload();
    await page.getByRole('button', { name: /^settings$/i }).click();
    await expect(page.getByRole('switch', { name: /music/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});

test.describe('playing the bot', () => {
  test('places bombs, plays turns, and reaches a result', async ({ page }) => {
    await openMenu(page);
    await page.getByRole('button', { name: /play vs bot/i }).click();
    await expect(page.getByRole('heading', { name: /choose a rival/i })).toBeVisible();

    await page.getByRole('button', { name: /easy/i }).click();
    await plantBombsManually(page);

    await expect(yourPlate(page)).toBeVisible();
    await expect(page.getByText(/their lives/i).first()).toBeVisible();
    await expect(page.getByText(/your lives/i).first()).toBeVisible();

    await playUntilOver(page);

    await expect(page.getByRole('heading', { name: /you (win|lose)/i })).toBeVisible();
    // Both plates open at the end, and only then.
    await expect(page.getByRole('grid', { name: /^your plate$/i })).toBeVisible();
    await expect(page.getByRole('grid', { name: /^their plate$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /rematch/i })).toBeVisible();
  });

  test('offers a random layout instead of tapping three chips', async ({ page }) => {
    await openMenu(page);
    await page.getByRole('button', { name: /play vs bot/i }).click();
    await page.getByRole('button', { name: /normal/i }).click();

    await page.getByRole('button', { name: /randomise/i }).click();
    await expect(page.getByText('3 / 3')).toBeVisible();
    await page.getByRole('button', { name: /^confirm$/i }).click();
    await expect(yourPlate(page)).toBeVisible();
  });

  test('will not let you play out of turn', async ({ page }) => {
    await openMenu(page);
    await page.getByRole('button', { name: /play vs bot/i }).click();
    await page.getByRole('button', { name: /expert/i }).click();
    await plantBombsManually(page);

    // Fire once, then confirm the board locks until the bot has replied.
    const clickable = yourPlate(page).locator(`${CHIP}[data-interactive="true"]`);
    if ((await clickable.count()) > 0) {
      await clickable.first().click();
      await page.waitForTimeout(500);
      await expect(yourPlate(page).locator(`${CHIP}[data-interactive="true"]`)).toHaveCount(0);
    }
  });

  test('starts a rematch with a fresh, hidden board', async ({ page }) => {
    await openMenu(page);
    await page.getByRole('button', { name: /play vs bot/i }).click();
    await page.getByRole('button', { name: /easy/i }).click();
    await plantBombsManually(page);
    await playUntilOver(page);

    await page.getByRole('button', { name: /rematch/i }).click();
    await expect(page.getByRole('heading', { name: /rig their chips/i })).toBeVisible();
    await expect(page.getByText('0 / 3')).toBeVisible();
  });
});

test.describe('two players', () => {
  test('create, join, ready up, and play against each other', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();

    try {
      await openMenu(host);
      await host.getByRole('button', { name: /play with friend/i }).click();
      await host.getByRole('button', { name: /create party/i }).click();

      const codeText = await host.locator('.code-display').innerText();
      const code = codeText.replace(/\s/g, '');
      expect(code).toMatch(/^[A-Z0-9]{6}$/);
      await expect(host.getByText(/waiting for player/i).first()).toBeVisible();

      await openMenu(guest);
      await guest.getByRole('button', { name: /play with friend/i }).click();
      await guest.getByRole('button', { name: /join party/i }).click();
      await guest.getByLabel(/party code/i).fill(code);
      await guest.getByRole('button', { name: /^join$/i }).click();

      // Both sides land in the lobby and can see each other.
      await expect(host.getByRole('heading', { name: /^lobby$/i })).toBeVisible();
      await expect(guest.getByRole('heading', { name: /^lobby$/i })).toBeVisible();

      await host.getByRole('button', { name: /^ready$/i }).click();
      await guest.getByRole('button', { name: /^ready$/i }).click();

      await plantBombsManually(host);
      await plantBombsManually(guest);

      await expect(yourPlate(host)).toBeVisible();
      await expect(yourPlate(guest)).toBeVisible();

      // Exactly one of them is on the clock.
      const hostActive = await yourPlate(host)
        .locator(`${CHIP}[data-interactive="true"]`)
        .count();
      const guestActive = await yourPlate(guest)
        .locator(`${CHIP}[data-interactive="true"]`)
        .count();
      expect(hostActive === 0 ? guestActive : hostActive).toBeGreaterThan(0);
      expect(hostActive > 0 && guestActive > 0).toBe(false);

      // A move on one screen shows up on the other.
      const mover = hostActive > 0 ? host : guest;
      const watcher = mover === host ? guest : host;
      await mover.locator(`${CHIP}[data-interactive="true"]`).first().click();

      await expect(
        theirPlate(watcher).locator(`${CHIP}[data-disabled="true"]`),
      ).not.toHaveCount(0);
      await expect(watcher.locator(`${CHIP}[data-interactive="true"]`)).not.toHaveCount(0);
    } finally {
      await hostContext.close();
      await guestContext.close();
    }
  });

  test('reports a bad party code without breaking', async ({ page }) => {
    await openMenu(page);
    await page.getByRole('button', { name: /play with friend/i }).click();
    await page.getByRole('button', { name: /join party/i }).click();
    await page.getByLabel(/party code/i).fill('QQQQQQ');
    await page.getByRole('button', { name: /^join$/i }).click();

    await expect(page.getByText(/party not found/i)).toBeVisible();
    // The screen is still usable afterwards.
    await expect(page.getByLabel(/party code/i)).toBeVisible();
  });

  test('drops a reloading player back into their match', async ({ page }) => {
    await openMenu(page);
    await page.getByRole('button', { name: /play vs bot/i }).click();
    await page.getByRole('button', { name: /normal/i }).click();
    await plantBombsManually(page);
    await expect(yourPlate(page)).toBeVisible();

    await page.reload();

    // Same seat, same bombs, straight back into the game — no menu in between.
    await expect(yourPlate(page)).toBeVisible({ timeout: 15_000 });
    await expect(theirPlate(page)).toBeVisible();
  });
});
