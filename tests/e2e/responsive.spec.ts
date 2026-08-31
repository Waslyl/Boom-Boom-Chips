/**
 * Responsive guarantees.
 *
 * The brief names four phone sizes and both orientations. Rather than eyeball
 * them, this measures the built game at each one and fails on the two things
 * that actually break a mobile game: content escaping the viewport, and chips
 * too small to hit with a thumb.
 */
import { expect, test, type Page } from '@playwright/test';

const CHIP = 'button.chip';

/** Apple and Google both put the floor for a touch target at ~44px. */
const MIN_TOUCH_TARGET = 44;

const SIZES = [
  { name: '360x800 (small Android)', width: 360, height: 800 },
  { name: '390x844 (iPhone 14)', width: 390, height: 844 },
  { name: '430x932 (iPhone Pro Max)', width: 430, height: 932 },
  { name: '768x1024 (tablet portrait)', width: 768, height: 1024 },
  { name: '932x430 (phone landscape)', width: 932, height: 430 },
  { name: '800x360 (short landscape)', width: 800, height: 360 },
  { name: '1440x900 (desktop)', width: 1440, height: 900 },
] as const;

interface Metrics {
  vOverflow: number;
  hOverflow: number;
  worstEscape: number;
  heroChip: number;
}

async function measure(page: Page): Promise<Metrics> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const hero = document.querySelector('[role="grid"][aria-label*="eat a chip"] button.chip');
    const heroChip = hero ? Math.round(hero.getBoundingClientRect().width) : 0;

    // How far does the worst-placed element stick outside the viewport?
    let worst = 0;
    for (const element of document.querySelectorAll('main *')) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      worst = Math.max(
        worst,
        box.bottom - window.innerHeight,
        box.right - window.innerWidth,
        -box.top,
        -box.left,
      );
    }

    return {
      vOverflow: root.scrollHeight - root.clientHeight,
      hOverflow: root.scrollWidth - root.clientWidth,
      worstEscape: Math.round(worst),
      heroChip,
    };
  });
}

async function reachTheBoard(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /play vs bot/i }).click();
  await page.getByRole('button', { name: /normal/i }).click();
  await page.getByRole('button', { name: /randomise/i }).click();
  await page.getByRole('button', { name: /^confirm$/i }).click();
  await expect(page.getByRole('grid', { name: /your plate: eat a chip/i })).toBeVisible();
  await page.waitForTimeout(400);
}

// One project is enough: these tests set their own viewport.
test.describe.configure({ mode: 'serial' });

for (const size of SIZES) {
  test(`the board fits and stays tappable at ${size.name}`, async ({ page }) => {
    test.skip(
      test.info().project.name !== 'desktop',
      'viewport is set explicitly; running once is enough',
    );

    await page.setViewportSize({ width: size.width, height: size.height });
    await reachTheBoard(page);

    const metrics = await measure(page);

    // Nothing may escape the viewport in any direction.
    expect(metrics.hOverflow, 'horizontal scroll').toBeLessThanOrEqual(1);
    expect(metrics.vOverflow, 'vertical scroll').toBeLessThanOrEqual(1);
    expect(metrics.worstEscape, 'element outside the viewport').toBeLessThanOrEqual(1);

    // The chips a player shoots at must stay comfortably thumb-sized.
    expect(metrics.heroChip, 'hero chip width').toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  });
}

test('the setup grid is tappable on the smallest supported phone', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'viewport is set explicitly');

  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: /play vs bot/i }).click();
  await page.getByRole('button', { name: /easy/i }).click();

  const chips = page.getByRole('grid', { name: /choose three chips/i }).locator(CHIP);
  const box = await chips.first().boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);

  // And they really do respond to a tap.
  await chips.nth(0).click();
  await expect(page.getByText('1 / 3')).toBeVisible();
});

test('switching orientation mid-match keeps the game intact', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'viewport is set explicitly');

  await page.setViewportSize({ width: 390, height: 844 });
  await reachTheBoard(page);
  const portraitChips = await page.locator(CHIP).count();

  // Rotate.
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(400);
  await expect(page.getByRole('grid', { name: /your plate: eat a chip/i })).toBeVisible();
  expect(await page.locator(CHIP).count()).toBe(portraitChips);

  const landscape = await measure(page);
  expect(landscape.hOverflow).toBeLessThanOrEqual(1);
  expect(landscape.vOverflow).toBeLessThanOrEqual(1);
  expect(landscape.heroChip).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);

  // And back again, still the same match.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await expect(page.getByRole('grid', { name: /your plate: eat a chip/i })).toBeVisible();
});

test('keyboard alone can place bombs and fire', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'pointerless input is a desktop concern');

  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/');
  await page.getByRole('button', { name: /play vs bot/i }).click();
  await page.getByRole('button', { name: /easy/i }).click();

  const chips = page.getByRole('grid', { name: /choose three chips/i }).locator(CHIP);
  await chips.first().focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('1 / 3')).toBeVisible();

  // Arrow keys walk the grid rather than trapping focus in one cell.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByText('3 / 3')).toBeVisible();

  await page.getByRole('button', { name: /^confirm$/i }).click();
  await expect(page.getByRole('grid', { name: /your plate: eat a chip/i })).toBeVisible();
});
