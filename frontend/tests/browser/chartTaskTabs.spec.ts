import { expect, test, type Locator, type Page } from "@playwright/test";

async function openDesktop(page: Page) {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/?chartFixture=240&chartFixtureTail=120");
  await expect(page.locator('[data-platform="desktop"]')).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.getByRole("tablist", { name: "Chart tasks" })).toBeVisible();
}

async function chooseArrangement(page: Page, label: string) {
  await page.getByRole("button", { name: "Layout", exact: true }).click();
  await page.getByRole("menuitemradio", { name: label, exact: true }).click();
}

test.describe("Chrome-style chart task tabs", () => {
  test("new tasks are isolated and switching restores each layout", async ({ page }) => {
    await openDesktop(page);
    const tabs = page.getByRole("tablist", { name: "Chart tasks" }).getByRole("tab");
    await expect(tabs).toHaveCount(1);

    await chooseArrangement(page, "Grid 2×2");
    await expect(page.locator('[data-chart-layout="grid_2x2"]')).toBeVisible();
    await page.getByRole("button", { name: "Trend line", exact: true }).click();
    await page.getByRole("button", { name: /^Trendline\b/ }).last().click();
    // The selected drawing tool has no standalone text output; the existing
    // chart test harness is the stable behavioral boundary for this state.
    await expect.poll(() =>
      page.evaluate(() => window.__drawingInteractionTest?.snapshot().activeTool)
    ).toBe("trendline");
    await page.getByRole("button", { name: "New chart task" }).click();

    await expect(tabs).toHaveCount(2);
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('[data-chart-layout="single"]')).toBeVisible();
    await expect.poll(() =>
      page.evaluate(() => window.__drawingInteractionTest?.snapshot().activeTool)
    ).toBe("crosshair");

    await tabs.nth(0).click();
    await expect(page.locator('[data-chart-layout="grid_2x2"]')).toBeVisible();
    await tabs.nth(1).click();
    await expect(page.locator('[data-chart-layout="single"]')).toBeVisible();
  });

  test("keyboard and pointer reorder preserve active identity and commit on release", async ({ page }) => {
    await openDesktop(page);
    const list = page.getByRole("tablist", { name: "Chart tasks" });
    const add = page.getByRole("button", { name: "New chart task" });
    await add.click();
    await add.click();
    const tabs = list.getByRole("tab");
    await expect(tabs).toHaveCount(3);

    const activeId = await activeTabId(list);
    const beforeKeyboard = await taskOrder(list);
    await tabs.nth(1).focus();
    await tabs.nth(1).press("Shift+ArrowLeft");
    const afterKeyboard = await taskOrder(list);
    expect(afterKeyboard).toEqual([
      beforeKeyboard[1],
      beforeKeyboard[0],
      beforeKeyboard[2],
    ]);
    await expect.poll(() => activeTabId(list)).toBe(activeId);

    const source = await tabs.nth(0).boundingBox();
    const target = await tabs.nth(2).boundingBox();
    expect(source).not.toBeNull();
    expect(target).not.toBeNull();
    const beforePointer = await taskOrder(list);
    await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
    await page.mouse.down();
    await page.mouse.move(source!.x + source!.width / 2 + 8, source!.y + source!.height / 2);
    await page.mouse.move(target!.x + target!.width - 4, target!.y + target!.height / 2, {
      steps: 5,
    });
    expect(await taskOrder(list)).toEqual(beforePointer);
    await page.mouse.up();
    await expect.poll(() => taskOrder(list)).toEqual([
      beforePointer[1],
      beforePointer[2],
      beforePointer[0],
    ]);
    await expect.poll(() => activeTabId(list)).toBe(activeId);

    const beforeInvalidDrop = await taskOrder(list);
    const invalidSource = await tabs.nth(0).boundingBox();
    expect(invalidSource).not.toBeNull();
    await page.mouse.move(
      invalidSource!.x + invalidSource!.width / 2,
      invalidSource!.y + invalidSource!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(invalidSource!.x + 10, invalidSource!.y - 80, {
      steps: 3,
    });
    await page.mouse.up();
    expect(await taskOrder(list)).toEqual(beforeInvalidDrop);
  });

  test("overflowed tasks auto-scroll and enforce the twelve-task cap", async ({ page }) => {
    await openDesktop(page);
    for (let index = 1; index < 12; index += 1) {
      await page.getByRole("button", { name: "New chart task" }).click();
    }

    const list = page.getByRole("tablist", { name: "Chart tasks" });
    const tabs = list.getByRole("tab");
    await expect(tabs).toHaveCount(12);
    await expect(
      page.getByRole("button", { name: "Maximum of 12 chart tasks" }),
    ).toBeDisabled();

    const source = await tabs.nth(0).boundingBox();
    const bounds = await list.boundingBox();
    expect(source).not.toBeNull();
    expect(bounds).not.toBeNull();
    await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
    await page.mouse.down();
    await page.mouse.move(source!.x + source!.width / 2 + 8, source!.y + source!.height / 2);
    await page.mouse.move(bounds!.x + bounds!.width - 3, bounds!.y + bounds!.height / 2, {
      steps: 5,
    });
    await expect.poll(() => list.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await page.mouse.up();
  });

  test("mobile presentation remains unchanged", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.locator('[data-platform="mobile"]')).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Chart tasks" })).toHaveCount(0);
  });
});

async function taskOrder(list: Locator): Promise<string[]> {
  return list.getByRole("tab").evaluateAll((nodes) => nodes.map((node) => node.id));
}

async function activeTabId(list: Locator): Promise<string | null> {
  return list.getByRole("tab").evaluateAll(
    (nodes) => nodes.find((node) => node.getAttribute("aria-selected") === "true")?.id ?? null,
  );
}
