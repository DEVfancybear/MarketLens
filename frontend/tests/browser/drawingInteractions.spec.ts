import { expect, test, type Page } from "@playwright/test";
import type { DrawingInteractionTestHarness } from "../../src/components/chart/drawing/testing/testHarnessTypes";

declare global {
  interface Window {
    __drawingInteractionTest?: DrawingInteractionTestHarness;
  }
}

const FIXTURE_URL = "/?chartFixture=900&chartFixtureTail=500&chartBenchmarkProfile=phase2";

async function drawingSnapshot(page: Page) {
  return page.evaluate(() => {
    if (!window.__drawingInteractionTest) {
      throw new Error("Drawing test harness unavailable");
    }
    return window.__drawingInteractionTest.snapshot();
  });
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/push/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForFunction(() =>
    Boolean(window.__drawingInteractionTest && window.__chartInteractionTest),
  );
  await page.evaluate(() => window.__drawingInteractionTest?.clear());
});

test("all persistent tools register and satisfy the executable adapter contract", async ({ page }) => {
  for (let iteration = 0; iteration < 3; iteration++) {
    const audit = await page.evaluate(() =>
      window.__drawingInteractionTest!.auditAdapters(),
    );
    expect(audit.expectedToolIds).toHaveLength(87);
    expect(audit.registeredToolIds).toEqual(audit.expectedToolIds);
    expect(audit.fixtureToolIds).toEqual(audit.expectedToolIds);
    expect(audit.errors).toEqual([]);
  }
});

test("all six cursor tools activate and own their distinct chart behavior", async ({ page }) => {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const point = {
    x: pane.x + pane.width * 0.48,
    y: pane.y + pane.height * 0.48,
  };
  const cursors = [
    ["Cross", "crosshair"],
    ["Dot", "dotCursor"],
    ["Arrow", "cursor"],
    ["Demonstration", "demonstrationCursor"],
    ["Magic", "magicCursor"],
    ["Eraser", "eraser"],
  ] as const;

  for (const [label, id] of cursors) {
    await page.getByRole("button", { name: "Cursor", exact: true }).click();
    await page.getByRole("button", { name: new RegExp(`^${label}\\b`) }).last().click();
    await expect.poll(async () => (await drawingSnapshot(page)).activeTool).toBe(id);
  }

  await page.getByRole("button", { name: "Cursor", exact: true }).click();
  await page.getByRole("button", { name: /^Dot\b/ }).last().click();
  await page.mouse.move(point.x, point.y);
  await expect(page.locator("[data-cursor-mode-overlay] circle")).toHaveCount(1);

  await page.getByRole("button", { name: "Cursor", exact: true }).click();
  await page.getByRole("button", { name: /^Magic\b/ }).last().click();
  await page.mouse.move(point.x, point.y);
  await expect(page.locator("[data-cursor-mode-overlay] text")).toHaveText("✦");

  await page.getByRole("button", { name: "Cursor", exact: true }).click();
  await page.getByRole("button", { name: /^Demonstration\b/ }).last().click();
  await page.keyboard.down("Alt");
  await page.mouse.move(point.x - 30, point.y - 20);
  await page.mouse.down();
  await page.mouse.move(point.x + 30, point.y + 20, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await expect(page.locator("[data-cursor-mode-overlay] polyline")).toHaveCount(1);
  expect((await drawingSnapshot(page)).drawings).toHaveLength(0);
});

test("Phase 8 Wave A range, cycle, and inline-note gestures commit transactionally", async ({ page }) => {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const a = { x: pane.x + pane.width * 0.28, y: pane.y + pane.height * 0.66 };
  const b = { x: pane.x + pane.width * 0.58, y: pane.y + pane.height * 0.36 };

  await page.getByRole("button", { name: "Ranges", exact: true }).click();
  await page.getByRole("button", { name: /^Date and price range\b/ }).click();
  await page.mouse.click(a.x, a.y); await page.mouse.click(b.x, b.y);

  await page.getByRole("button", { name: "Patterns", exact: true }).click();
  await page.getByRole("button", { name: /^Cyclic lines\b/ }).click();
  await page.mouse.click(a.x + 40, a.y); await page.mouse.click(b.x + 40, b.y);

  await page.getByRole("button", { name: "Text", exact: true }).click();
  await page.getByRole("button", { name: /^Note\b/ }).click();
  await page.mouse.click(a.x, b.y);
  const editor = page.getByPlaceholder("Enter text...");
  await editor.fill("Wave A note"); await editor.press("Enter");

  await expect.poll(async () => (await drawingSnapshot(page)).drawings.map((drawing) => drawing.tool))
    .toEqual(["datePriceRange", "cyclicLines", "note"]);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.map((drawing) => drawing.tool))
    .toEqual(["datePriceRange", "cyclicLines"]);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[2]?.text).toBe("Wave A note");
});

test("Phase 8 Wave B level, radial, grid, and pitchfork gestures use manifest contracts", async ({ page }) => {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const a = { x: pane.x + pane.width * 0.24, y: pane.y + pane.height * 0.66 };
  const b = { x: pane.x + pane.width * 0.48, y: pane.y + pane.height * 0.36 };
  const c = { x: pane.x + pane.width * 0.64, y: pane.y + pane.height * 0.56 };
  const create = async (
    group: "Fib Retracement" | "Trend line",
    name: RegExp,
    points: typeof a[],
  ) => {
    await page.getByRole("button", { name: group, exact: true }).click();
    await page.getByRole("button", { name }).click();
    for (const point of points) await page.mouse.click(point.x, point.y);
  };
  await create("Fib Retracement", /^Fib Channel\b/, [a,b,c]);
  await create("Fib Retracement", /^Fib Speed Resistance Fan\b/, [a,b]);
  await create("Fib Retracement", /^Fib Circles\b/, [a,b]);
  await create("Fib Retracement", /^Gann Square\b/, [a,b]);
  await create("Trend line", /^Pitchfork\b/, [a,b,c]);
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.map((drawing) => drawing.tool))
    .toEqual(["fibChannel","fibSpeedFan","fibCircles","gannSquare","pitchfork"]);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(4);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(5);
});

test("Phase 8 Wave C harmonic, Elliott, and cycle gestures use fixed manifest topologies", async ({ page }) => {
  const chart=await page.evaluate(()=>window.__chartInteractionTest!.snapshot());const pane=chart.paneBoxes[0];
  const points=Array.from({length:7},(_,index)=>({x:pane.x+pane.width*(.18+index*.09),y:pane.y+pane.height*(index%2===0?.65:.35)}));
  const create=async(name:RegExp,count:number)=>{await page.getByRole("button",{name:"Patterns",exact:true}).click();await page.getByRole("button",{name}).click();for(const point of points.slice(0,count))await page.mouse.click(point.x,point.y);};
  await create(/^ABCD Pattern\b/,4);
  await create(/^Head and Shoulders\b/,7);
  await create(/^Elliott Impulse Wave\b/,6);
  await create(/^Time Cycles\b/,2);
  await expect.poll(async()=>(await drawingSnapshot(page)).drawings.map((drawing)=>drawing.tool)).toEqual(["abcdPattern","headShouldersPattern","elliottImpulse","timeCycles"]);
  await expect.poll(async()=>(await drawingSnapshot(page)).machineState).toBe("Idle");
  await expect.poll(async()=>(await drawingSnapshot(page)).activeTool).toBe("crosshair");
  await expect.poll(async()=>(await drawingSnapshot(page)).history.lastUndoLabel).toBe("Create Drawing");
  await page.keyboard.press("Control+z");
  await expect.poll(async()=>(await drawingSnapshot(page)).drawings.length).toBe(3);
  await page.keyboard.press("Control+Shift+z");await expect.poll(async()=>(await drawingSnapshot(page)).drawings.length).toBe(4);
});

test("Phase 8 Wave D data, projection, and rich-content gestures persist their contracts", async ({ page }) => {
  const chart=await page.evaluate(()=>window.__chartInteractionTest!.snapshot());const pane=chart.paneBoxes[0];
  const a={x:pane.x+pane.width*.24,y:pane.y+pane.height*.62},b={x:pane.x+pane.width*.62,y:pane.y+pane.height*.36},c={x:pane.x+pane.width*.74,y:pane.y+pane.height*.54};
  await page.getByRole("button",{name:"Magnet mode menu",exact:true}).click();await page.getByRole("button",{name:"Strong magnet",exact:true}).click();
  const create=async(group:"Trend line"|"Ranges"|"Text",name:RegExp,points:(typeof a)[])=>{await page.getByRole("button",{name:group,exact:true}).click();await page.getByRole("button",{name}).click();for(const point of points)await page.mouse.click(point.x,point.y);};
  await create("Trend line",/^Anchored VWAP\b/,[a]);
  await create("Trend line",/^Regression Trend\b/,[a,b]);
  await create("Ranges",/^Fixed Range Volume Profile\b/,[a,b]);
  await create("Ranges",/^Forecast\b/,[a,b,c]);
  await create("Text",/^Table\b/,[a,b]);
  await create("Text",/^X post \/ idea\b/,[c]);
  const editor=page.getByPlaceholder("Enter text...");await editor.fill("https://x.com/openai/status/1");await editor.press("Enter");
  await expect.poll(async()=>{const drawings=(await drawingSnapshot(page)).drawings;return drawings.map(d=>({tool:d.tool,samples:d.dataSnapshot?.samples.length??0,text:d.text??""}));}).toEqual([
    {tool:"anchoredVWAP",samples:expect.any(Number),text:""},{tool:"regressionTrend",samples:expect.any(Number),text:""},{tool:"fixedVolumeProfile",samples:expect.any(Number),text:""},{tool:"forecast",samples:0,text:""},{tool:"table",samples:0,text:""},{tool:"socialEmbed",samples:0,text:"https://x.com/openai/status/1"},
  ]);
  const drawings=(await drawingSnapshot(page)).drawings;expect(drawings.slice(0,3).every(d=>(d.dataSnapshot?.samples.length??0)>0)).toBe(true);
});

test("settings dialog exposes keyboard semantics and returns focus on Escape", async ({ page }) => {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const start = { x: pane.x + pane.width * 0.3, y: pane.y + pane.height * 0.65 };
  const end = { x: pane.x + pane.width * 0.62, y: pane.y + pane.height * 0.35 };

  await page.getByRole("button", { name: "Trend line", exact: true }).click();
  await page.getByRole("button", { name: /^Trendline\b/ }).click();
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(end.x, end.y);
  const created = await drawingSnapshot(page);
  const projected = await page.evaluate(
    (id) => window.__drawingInteractionTest!.projectDrawing(id),
    created.drawings[0].id,
  );
  await page.getByRole("button", { name: "Cursor", exact: true }).click();
  await page.getByRole("button", { name: /^Cross\b/ }).last().click();
  await page.mouse.click(
    projected![0].x + (projected![1].x - projected![0].x) * 0.75,
    projected![0].y + (projected![1].y - projected![0].y) * 0.75,
  );

  const settingsButton = page.getByRole("button", { name: "Settings", exact: true });
  await settingsButton.focus();
  await settingsButton.click();
  const dialog = page.getByRole("dialog", { name: "Trendline settings" });
  await expect(dialog).toBeFocused();
  await expect(dialog.getByRole("tab", { name: "style", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(dialog.getByRole("tablist", { name: "Drawing settings sections" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(settingsButton).toBeFocused();
});

test("save-template dialog validates, saves, reselects, and deletes a preset", async ({ page }) => {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const start = { x: pane.x + pane.width * 0.3, y: pane.y + pane.height * 0.65 };
  const end = { x: pane.x + pane.width * 0.62, y: pane.y + pane.height * 0.35 };
  const presetName = "Browser behavior preset";

  await page.getByRole("button", { name: "Trend line", exact: true }).click();
  await page.getByRole("button", { name: /^Trendline\b/ }).click();
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(end.x, end.y);
  const created = await drawingSnapshot(page);
  const projected = await page.evaluate(
    (id) => window.__drawingInteractionTest!.projectDrawing(id),
    created.drawings[0].id,
  );
  await page.getByRole("button", { name: "Cursor", exact: true }).click();
  await page.getByRole("button", { name: /^Cross\b/ }).last().click();
  await page.mouse.click(
    projected![0].x + (projected![1].x - projected![0].x) * 0.75,
    projected![0].y + (projected![1].y - projected![0].y) * 0.75,
  );

  const templates = page.getByRole("button", { name: "Templates", exact: true });
  await templates.click();
  await page.getByRole("button", { name: /Save as template/ }).click();
  let dialog = page.getByRole("dialog", { name: "Save drawing template" });
  await expect(dialog).toBeVisible();
  const nameInput = dialog.getByRole("textbox", { name: "New template name" });
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await nameInput.fill(`  ${presetName}  `);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await templates.click();
  await expect(page.getByRole("button", { name: presetName, exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Save as template/ }).click();
  dialog = page.getByRole("dialog", { name: "Save drawing template" });
  await dialog.getByRole("button", { name: "Show saved templates" }).click();
  await dialog.getByRole("button", { name: presetName, exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "New template name" })).toHaveValue(presetName);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await templates.click();
  await page.getByRole("button", { name: `Delete ${presetName}` }).click();
  await templates.click();
  await templates.click();
  await expect(page.getByRole("button", { name: presetName, exact: true })).toHaveCount(0);
});

test("fixed drawing targets create independent price-alert snapshots", async ({ page }) => {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const anchor = { x: pane.x + pane.width * 0.42, y: pane.y + pane.height * 0.46 };

  await page.getByRole("button", { name: "Trend line", exact: true }).click();
  await page.getByRole("button", { name: /^Horizontal line\b/ }).click();
  await page.mouse.click(anchor.x, anchor.y);
  const created = await drawingSnapshot(page);
  const id = created.drawings[0].id;
  const projected = await page.evaluate(
    (drawingId) => window.__drawingInteractionTest!.projectDrawing(drawingId),
    id,
  );

  await page.getByRole("button", { name: "Cursor", exact: true }).click();
  await page.getByRole("button", { name: /^Cross\b/ }).last().click();
  await page.mouse.click(pane.x + pane.width * 0.64, projected![0].y);
  await page.getByTestId("price-chart-root").getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "Add alert", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Create drawing alert" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Drawing alert target" })).toContainText("Price level");
  await dialog.getByRole("button", { name: "Create alert", exact: true }).click();

  const center = page.getByRole("dialog", { name: "Alert Center" });
  await expect(center.getByText("Drawing · Price level", { exact: true })).toBeVisible();
  // Close through the backdrop. Alert evaluation may legitimately add a
  // top-right toast over the drawer's Close button in this same frame.
  await page.mouse.click(20, page.viewportSize()!.height / 2);
  await expect(center).toHaveCount(0);

  await page.mouse.click(pane.x + pane.width * 0.64, projected![0].y);
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(0);
  // A just-triggered alert toast can overlap this top-right toolbar button.
  // Dispatch through the element so the snapshot contract is not coupled to
  // the toast's dismissal timer.
  await page.getByRole("button", { name: /^Alerts\b/ }).evaluate(
    (button: HTMLButtonElement) => button.click(),
  );
  await expect(page.getByRole("dialog", { name: "Alert Center" }).getByText("Drawing · Price level", { exact: true })).toBeVisible();
});

test("object tree groups, renames, locks, hides, and undo-redoes as one group action", async ({ page }) => {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const points = [
    { x: pane.x + pane.width * 0.22, y: pane.y + pane.height * 0.68 },
    { x: pane.x + pane.width * 0.43, y: pane.y + pane.height * 0.42 },
    { x: pane.x + pane.width * 0.51, y: pane.y + pane.height * 0.65 },
    { x: pane.x + pane.width * 0.72, y: pane.y + pane.height * 0.37 },
  ];
  await page.getByRole("button", { name: "Keep drawing", exact: true }).click();
  await page.getByRole("button", { name: "Trend line", exact: true }).click();
  await page.getByRole("button", { name: /^Trendline\b/ }).click();
  for (const point of points) await page.mouse.click(point.x, point.y);
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(2);

  await page.getByRole("button", { name: "Object tree", exact: true }).click();
  const tree = page.locator("[data-object-tree]");
  await expect(tree).toBeVisible();
  const rows = tree.locator("[data-object-id]");
  await expect(rows).toHaveCount(2);
  await rows.nth(0).click({ position: { x: 12, y: 16 } });
  await rows.nth(1).click({ modifiers: ["Control"], position: { x: 12, y: 16 } });
  // Runtime connection toasts occupy the same top-right pixels in CI; this
  // control is already asserted visible/enabled, so dispatch directly.
  await tree.getByRole("button", { name: "Group selected", exact: true })
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(tree.locator("[data-object-group]")).toHaveCount(1);
  await page.keyboard.press("Control+z");
  await expect(tree.locator("[data-object-group]")).toHaveCount(0);
  await page.keyboard.press("Control+Shift+z");
  const group = tree.locator("[data-object-group]");
  await expect(group).toHaveCount(1);

  await group.getByRole("button", { name: "Rename", exact: true }).first().click();
  const rename = group.getByRole("textbox", { name: "Rename group", exact: true });
  await rename.fill("Breakout setup");
  await rename.press("Enter");
  await expect(group).toContainText("Breakout setup");
  await group.getByRole("button", { name: "Hide", exact: true }).first().click();
  await group.getByRole("button", { name: "Lock", exact: true }).first().click();
  await expect.poll(async () => {
    const drawings = (await drawingSnapshot(page)).drawings;
    return drawings.every((drawing) =>
      drawing.group?.name === "Breakout setup" &&
      drawing.visible === false &&
      drawing.locked === true
    );
  }).toBe(true);
});

test("drawing sync defaults persist and a group changes scope in one undoable action", async ({ page }) => {
  const syncDefault = page.getByRole("button", { name: "New drawings: Sync globally", exact: true });
  await syncDefault.click();
  await page.getByRole("button", { name: "No sync", exact: true }).click();
  await expect(page.getByRole("button", { name: "New drawings: No sync", exact: true })).toBeVisible();

  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const points = [
    { x: pane.x + pane.width * 0.24, y: pane.y + pane.height * 0.67 },
    { x: pane.x + pane.width * 0.43, y: pane.y + pane.height * 0.43 },
    { x: pane.x + pane.width * 0.53, y: pane.y + pane.height * 0.64 },
    { x: pane.x + pane.width * 0.72, y: pane.y + pane.height * 0.38 },
  ];
  await page.getByRole("button", { name: "Keep drawing", exact: true }).click();
  await page.getByRole("button", { name: "Trend line", exact: true }).click();
  await page.getByRole("button", { name: /^Trendline\b/ }).click();
  for (const point of points) await page.mouse.click(point.x, point.y);
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.map((drawing) => drawing.sync?.mode)).toEqual(["chart-only", "chart-only"]);

  await page.getByRole("button", { name: "Object tree", exact: true }).click();
  const tree = page.locator("[data-object-tree]");
  const rows = tree.locator("[data-object-id]");
  await rows.nth(0).click({ position: { x: 12, y: 16 } });
  await rows.nth(1).click({ modifiers: ["Control"], position: { x: 12, y: 16 } });
  await tree.getByRole("button", { name: "Group selected", exact: true })
    .evaluate((button: HTMLButtonElement) => button.click());
  const group = tree.locator("[data-object-group]");
  const groupHeader = group.locator(":scope > div").first();
  await groupHeader.getByRole("button", { name: "Sync: chart-only", exact: true }).click();
  await groupHeader.getByRole("button", { name: /^Sync globally / }).click();
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.every((drawing) => drawing.sync?.mode === "global")).toBe(true);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.every((drawing) => drawing.sync?.mode === "chart-only")).toBe(true);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__drawingInteractionTest));
  await expect(page.getByRole("button", { name: "New drawings: No sync", exact: true })).toBeVisible();
});

test("selected and all drawing bulk actions are single undoable transactions", async ({ page }) => {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const points = [
    { x: pane.x + pane.width * 0.23, y: pane.y + pane.height * 0.68 },
    { x: pane.x + pane.width * 0.43, y: pane.y + pane.height * 0.42 },
    { x: pane.x + pane.width * 0.53, y: pane.y + pane.height * 0.64 },
    { x: pane.x + pane.width * 0.73, y: pane.y + pane.height * 0.37 },
  ];
  await page.getByRole("button", { name: "Keep drawing", exact: true }).click();
  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  await page.getByRole("button", { name: /^Rectangle\b/ }).last().click();
  for (const point of points) await page.mouse.click(point.x, point.y);
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(2);
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.map((item) => item.tool))
    .toEqual(["rectangle", "rectangle"]);

  await page.getByRole("button", { name: "Object tree", exact: true }).click();
  const tree = page.locator("[data-object-tree]");
  const selectBoth = async () => {
    const rows = tree.locator("[data-object-id]");
    await rows.nth(0).click({ position: { x: 12, y: 16 } });
    await rows.nth(1).click({ modifiers: ["Control"], position: { x: 12, y: 16 } });
    await expect(tree.getByRole("button", { name: "Lock selected", exact: true })).toBeEnabled();
  };
  await selectBoth();
  const floatingToolbar = page.locator("[data-drawing-toolbar][data-chart-popup]");
  await expect(floatingToolbar.locator("[data-drawing-selection-count]")).toHaveText("2 selected");
  await floatingToolbar.getByRole("button", { name: "Selected drawing color", exact: true }).click();
  const colorPopover = page.locator("[data-color-popover][data-drawing-toolbar-popover]");
  await expect(colorPopover).toBeVisible();
  await colorPopover.getByRole("button", { name: "Use #ef5350", exact: true }).click();
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.map((item) => item.color))
    .toEqual(["#ef5350", "#ef5350"]);
  await expect.poll(async () => (await drawingSnapshot(page)).history.lastUndoLabel)
    .toBe("Change Drawing Colors");
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.map((item) => item.color))
    .toEqual(["#2962ff", "#2962ff"]);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.map((item) => item.color))
    .toEqual(["#ef5350", "#ef5350"]);

  await floatingToolbar.getByRole("button", { name: "Background color", exact: true }).click();
  const fillPopover = page.locator("[data-color-popover][data-drawing-toolbar-popover]");
  await expect(fillPopover).toBeVisible();
  await fillPopover.getByRole("button", { name: "Use #ff9800", exact: true }).click();
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.map((item) => item.fillColor))
    .toEqual(["#ff9800", "#ff9800"]);
  await expect.poll(async () => (await drawingSnapshot(page)).history.lastUndoLabel)
    .toBe("Change Fill Colors");
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.map((item) => item.fillColor))
    .toEqual([undefined, undefined]);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.map((item) => item.fillColor))
    .toEqual(["#ff9800", "#ff9800"]);

  await tree.getByRole("button", { name: "Lock selected", exact: true }).evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.every((drawing) => drawing.locked)).toBe(true);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.every((drawing) => !drawing.locked)).toBe(true);

  await tree.getByRole("button", { name: "Hide selected", exact: true }).evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.every((drawing) => drawing.visible === false)).toBe(true);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.every((drawing) => drawing.visible !== false)).toBe(true);

  await selectBoth();
  await tree.getByRole("button", { name: "Delete selected", exact: true }).evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(0);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(2);

  await page.getByRole("button", { name: "Lock all drawings", exact: true }).evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.every((drawing) => drawing.locked)).toBe(true);
  await page.keyboard.press("Control+z");
  await page.getByRole("button", { name: "Hide all drawings", exact: true }).evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.every((drawing) => drawing.visible === false)).toBe(true);
  await page.keyboard.press("Control+z");
  await page.getByRole("button", { name: "Remove all drawings", exact: true }).evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(0);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(2);
});

test("shared color picker shields canvas input and repaints a selected shape", async ({ page }) => {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const start = { x: pane.x + pane.width * 0.28, y: pane.y + pane.height * 0.68 };
  const end = { x: pane.x + pane.width * 0.56, y: pane.y + pane.height * 0.48 };

  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  await page.getByRole("button", { name: /^Rectangle\b/ }).last().click();
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(end.x, end.y);
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(1);

  const before = await page.locator("[data-drawing-canvas]").evaluate(
    (canvas: HTMLCanvasElement) => canvas.toDataURL(),
  );
  const toolbar = page.locator("[data-drawing-toolbar][data-chart-popup]");
  await toolbar.getByRole("button", { name: "Line color", exact: true }).click();
  const colorPopover = page.locator("[data-color-popover][data-drawing-toolbar-popover]");
  await expect(colorPopover).toHaveAttribute("data-chart-ui", "true");
  await colorPopover.getByRole("button", { name: "Add custom color", exact: true }).click();
  await expect(colorPopover).toHaveAttribute("data-color-picker-view", "custom");
  await colorPopover.getByRole("textbox", { name: "Custom color hex", exact: true }).fill("#123abc");
  await colorPopover.getByRole("button", { name: "Add", exact: true }).click();
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[0]?.color).toBe("#123abc");

  const selectedAfterCustomColor = await drawingSnapshot(page);
  expect(selectedAfterCustomColor.selectedDrawingId).toBe(selectedAfterCustomColor.drawings[0].id);
  expect(selectedAfterCustomColor.drawings).toHaveLength(1);

  await toolbar.getByRole("button", { name: "Background color", exact: true }).click();
  const fillPopover = page.locator("[data-color-popover][data-drawing-toolbar-popover]");
  await fillPopover.getByRole("button", { name: "Use #ff9800", exact: true }).click();
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[0]?.fillColor).toBe("#ff9800");

  await toolbar.getByRole("button", { name: "Background color", exact: true }).click();
  await page.locator("[data-color-popover] input[aria-label='Opacity percent']").fill("45");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[0]?.opacity).toBe(0.45);
  await expect.poll(async () => page.locator("[data-drawing-canvas]").evaluate(
    (canvas: HTMLCanvasElement) => canvas.toDataURL(),
  )).not.toBe(before);
});

test("shared coordinate editor updates anchors in one undoable transaction", async ({ page }) => {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const start = { x: pane.x + pane.width * 0.3, y: pane.y + pane.height * 0.65 };
  const end = { x: pane.x + pane.width * 0.62, y: pane.y + pane.height * 0.35 };

  await page.getByRole("button", { name: "Trend line", exact: true }).click();
  await page.getByRole("button", { name: /^Trendline\b/ }).click();
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(end.x, end.y);
  const created = await drawingSnapshot(page);
  const projected = await page.evaluate(
    (id) => window.__drawingInteractionTest!.projectDrawing(id),
    created.drawings[0].id,
  );
  await page.getByRole("button", { name: "Cursor", exact: true }).click();
  await page.getByRole("button", { name: /^Cross\b/ }).last().click();
  await page.mouse.click(
    projected![0].x + (projected![1].x - projected![0].x) * 0.75,
    projected![0].y + (projected![1].y - projected![0].y) * 0.75,
  );
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Trendline settings" });
  await dialog.getByRole("tab", { name: "coordinates", exact: true }).click();
  // Capture the state the settings transaction actually opened with. Drawing
  // persistence may canonicalize click-projected floats between creation and
  // opening the editor by a few ULPs.
  const original = (await drawingSnapshot(page)).drawings[0].points;
  const nextPrice = original[0].price + 1.25;
  const nextTime = original[0].time + 60;
  await dialog.getByRole("spinbutton", { name: "Point 1 price", exact: true }).fill(String(nextPrice));
  await dialog.getByRole("spinbutton", { name: "Point 1 price", exact: true }).press("Enter");
  await dialog.getByRole("spinbutton", { name: "Point 1 Unix time", exact: true }).fill(String(nextTime));
  await dialog.getByRole("spinbutton", { name: "Point 1 Unix time", exact: true }).press("Enter");
  await dialog.getByRole("button", { name: "Ok", exact: true }).click();
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[0].points[0])
    .toEqual({ time: nextTime, price: nextPrice });
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[0].points).toEqual(original);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[0].points[0])
    .toEqual({ time: nextTime, price: nextPrice });
});

test("keep drawing creates consecutive objects and survives reload", async ({ page }) => {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const points = [
    { x: pane.x + pane.width * 0.2, y: pane.y + pane.height * 0.7 },
    { x: pane.x + pane.width * 0.4, y: pane.y + pane.height * 0.45 },
    { x: pane.x + pane.width * 0.5, y: pane.y + pane.height * 0.65 },
    { x: pane.x + pane.width * 0.7, y: pane.y + pane.height * 0.35 },
  ];

  const keepDrawing = page.getByRole("button", { name: "Keep drawing", exact: true });
  await keepDrawing.click();
  await page.getByRole("button", { name: "Trend line", exact: true }).click();
  await page.getByRole("button", { name: /^Trendline\b/ }).click();
  for (const point of points) await page.mouse.click(point.x, point.y);

  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(2);
  expect((await drawingSnapshot(page)).activeTool).toBe("trendline");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__drawingInteractionTest));
  await expect(page.getByRole("button", { name: "Keep drawing", exact: true }))
    .toHaveClass(/text-brand/);
});

test("confirmed settings become the persisted default for the same tool", async ({ page }) => {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const start = { x: pane.x + pane.width * 0.25, y: pane.y + pane.height * 0.65 };
  const end = { x: pane.x + pane.width * 0.55, y: pane.y + pane.height * 0.4 };

  const selectTrendline = async () => {
    await page.getByRole("button", { name: "Trend line", exact: true }).click();
    await page.getByRole("button", { name: /^Trendline\b/ }).click();
  };
  await selectTrendline();
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(end.x, end.y);
  const created = await drawingSnapshot(page);
  const projected = await page.evaluate(
    (id) => window.__drawingInteractionTest!.projectDrawing(id),
    created.drawings[0].id,
  );
  await page.getByRole("button", { name: "Cursor", exact: true }).click();
  await page.getByRole("button", { name: /^Cross\b/ }).last().click();
  await page.mouse.click(
    projected![0].x + (projected![1].x - projected![0].x) * 0.75,
    projected![0].y + (projected![1].y - projected![0].y) * 0.75,
  );
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Trendline settings" });
  await dialog.getByRole("button", { name: "Line style", exact: true }).click();
  const width = dialog.getByRole("slider", { name: "Line width", exact: true });
  await width.fill("4");
  await dialog.getByRole("button", { name: "Ok", exact: true }).click();

  await page.evaluate(() => window.__drawingInteractionTest!.clear());
  await selectTrendline();
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(end.x, end.y);
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[0]?.lineWidth).toBe(4);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__drawingInteractionTest));
  await page.evaluate(() => window.__drawingInteractionTest!.clear());
  await selectTrendline();
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(end.x, end.y);
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[0]?.lineWidth).toBe(4);
});

test("strong OHLC magnet snaps creation and Ctrl temporarily disables it", async ({ page }) => {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const first = { x: pane.x + pane.width * 0.37, y: pane.y + pane.height * 0.43 };
  const second = { x: pane.x + pane.width * 0.61, y: pane.y + pane.height * 0.57 };

  await page.getByRole("button", { name: "Magnet mode menu", exact: true }).click();
  await page.getByRole("button", { name: "Strong magnet", exact: true }).click();
  await expect(page.getByRole("button", { name: "Magnet: strong", exact: true }))
    .toHaveClass(/text-brand/);

  const chooseHorizontal = async () => {
    await page.getByRole("button", { name: "Trend line", exact: true }).click();
    await page.getByRole("button", { name: /^Horizontal line\b/ }).click();
  };
  const expectedStrong = await page.evaluate(
    ({ x, y }) => window.__drawingInteractionTest!.magnetPointsAtClient(x, y).strong,
    first,
  );
  await chooseHorizontal();
  await page.mouse.click(first.x, first.y);
  await expect.poll(async () => {
    const point = (await drawingSnapshot(page)).drawings[0]?.points[0];
    return point && expectedStrong
      ? point.time === expectedStrong.time && Math.abs(point.price - expectedStrong.price) < 0.00001
      : false;
  }).toBe(true);

  await page.evaluate(() => window.__drawingInteractionTest!.clear());
  const expectedRaw = await page.evaluate(
    ({ x, y }) => window.__drawingInteractionTest!.magnetPointsAtClient(x, y).raw,
    second,
  );
  await chooseHorizontal();
  await page.keyboard.down("Control");
  await page.mouse.click(second.x, second.y);
  await page.keyboard.up("Control");
  await expect.poll(async () => {
    const point = (await drawingSnapshot(page)).drawings[0]?.points[0];
    return point && expectedRaw
      ? point.time === expectedRaw.time && Math.abs(point.price - expectedRaw.price) < 0.00001
      : false;
  }).toBe(true);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__drawingInteractionTest));
  await expect(page.getByRole("button", { name: "Magnet: strong", exact: true }))
    .toHaveClass(/text-brand/);
});

test("interval visibility settings filter drawings and quick presets update the model", async ({ page }) => {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const start = { x: pane.x + pane.width * 0.28, y: pane.y + pane.height * 0.65 };
  const end = { x: pane.x + pane.width * 0.58, y: pane.y + pane.height * 0.38 };

  await page.getByRole("button", { name: "Trend line", exact: true }).click();
  await page.getByRole("button", { name: /^Trendline\b/ }).click();
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(end.x, end.y);
  const created = await drawingSnapshot(page);
  const id = created.drawings[0].id;
  const projected = await page.evaluate(
    (drawingId) => window.__drawingInteractionTest!.projectDrawing(drawingId),
    id,
  );
  const body = {
    x: projected![0].x + (projected![1].x - projected![0].x) * 0.75,
    y: projected![0].y + (projected![1].y - projected![0].y) * 0.75,
  };

  await page.getByRole("button", { name: "Cursor", exact: true }).click();
  await page.getByRole("button", { name: /^Cross\b/ }).last().click();
  await page.mouse.click(body.x, body.y);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Trendline settings" });
  await dialog.getByRole("tab", { name: "visibility", exact: true }).click();
  await dialog.getByRole("button", { name: "Current interval", exact: true }).click();
  await dialog.getByRole("button", { name: "Ok", exact: true }).click();
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[0]?.intervalVisibility)
    .toEqual({ timeframes: ["15m"] });

  await page.getByTestId("price-chart-root").getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "Intervals: Current and above", exact: true }).click();
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[0]?.intervalVisibility)
    .toEqual({ timeframes: ["15m", "30m", "1H", "2H", "4H", "1D", "1W", "1M"] });

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const reopened = page.getByRole("dialog", { name: "Trendline settings" });
  await reopened.getByRole("tab", { name: "visibility", exact: true }).click();
  await reopened.getByRole("button", { name: "Current interval", exact: true }).click();
  await reopened.getByRole("button", { name: "Ok", exact: true }).click();
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[0]?.intervalVisibility)
    .toEqual({ timeframes: ["15m"] });

  await page.evaluate(() => window.__drawingInteractionTest!.changeTimeframe("1H"));
  await expect.poll(async () => (await drawingSnapshot(page)).visibleDrawingIds).toEqual([]);
  await expect.poll(async () => (await drawingSnapshot(page)).selectedDrawingId).toBeNull();

  await page.evaluate(() => window.__drawingInteractionTest!.changeTimeframe("15m"));
  await expect.poll(async () => (await drawingSnapshot(page)).visibleDrawingIds).toEqual([id]);
});

test("compact one-click Long position moves from the overlapping entry handles without changing its geometry", async ({ page }) => {
  await page.evaluate(() => window.__chartInteractionTest!.setBarSpacing(1.5));
  await expect.poll(async () =>
    (await page.evaluate(() => window.__chartInteractionTest!.snapshot())).barSpacing,
  ).toBe(1.5);
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const creationPoint = {
    x: pane.x + pane.width * 0.2,
    y: pane.y + pane.height * 0.52,
  };

  const longPositionButtons = page.getByRole("button", {
    name: "Long position",
    exact: true,
  });
  await longPositionButtons.first().click();
  await page.getByRole("button", { name: /^Long position\b/ }).last().click();
  await page.mouse.click(creationPoint.x, creationPoint.y);

  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(1);
  const created = await drawingSnapshot(page);
  const drawing = created.drawings[0];
  expect(drawing.tool).toBe("long");
  expect(drawing.points).toHaveLength(3);

  const projectPosition = () => page.evaluate(
    (id) => window.__drawingInteractionTest!.projectDrawing(id),
    drawing.id,
  );
  let projected = await projectPosition();
  expect(projected).not.toBeNull();
  const initialWidth = Math.abs(projected![1].x - projected![0].x);
  expect(initialWidth).toBeGreaterThanOrEqual(158);
  expect(projected![1].y).toBeGreaterThan(pane.y);
  expect(projected![1].y).toBeLessThan(pane.y + pane.height);
  expect(projected![2].y).toBeGreaterThan(pane.y);
  expect(projected![2].y).toBeLessThan(pane.y + pane.height);

  if (created.activeTool !== "crosshair") {
    await page.getByRole("button", { name: "Cursor", exact: true }).click();
    await page.getByRole("button", { name: /^Cross\b/ }).last().click();
  }

  // First use the exact right-entry handle to create a deterministic 40px
  // compact object, then exercise the ambiguous
  // midpoint that used to be classified as another resize.
  projected = await projectPosition();
  expect(projected).not.toBeNull();
  const [initialEntryLeft, initialTargetRight] = projected!;
  const rightEntryHandle = {
    x: initialTargetRight.x,
    y: initialEntryLeft.y,
  };
  const handleInspection = await page.evaluate(
    ({ x, y }) => window.__drawingInteractionTest!.inspectClientPoint(x, y),
    rightEntryHandle,
  );
  const interactionSnapshot = await drawingSnapshot(page);
  expect(
    handleInspection.insideCanvas,
    JSON.stringify({
      rightEntryHandle,
      projected,
      canvas: interactionSnapshot.canvas,
      creationPoint,
      drawingPoints: drawing.points,
    }),
  ).toBe(true);
  expect(handleInspection.overDrawingUi).toBe(false);
  expect(handleInspection.hits.some((hit) =>
    hit.id === drawing.id && hit.anchorIndex === 4
  )).toBe(true);
  await page.mouse.move(rightEntryHandle.x, rightEntryHandle.y);
  await page.mouse.down();
  await expect.poll(async () => (await drawingSnapshot(page)).machineState)
    .toBe("ResizingHandle");
  await page.mouse.move(initialEntryLeft.x + 40, initialEntryLeft.y, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await drawingSnapshot(page)).machineState).toBe("Idle");

  await expect.poll(async () => {
    const points = await projectPosition();
    return points ? Math.abs(points[1].x - points[0].x) : Number.POSITIVE_INFINITY;
  }).toBeLessThan(52);
  projected = await projectPosition();
  expect(projected).not.toBeNull();
  const [entryLeft, targetRight] = projected!;
  const compactWidth = Math.abs(targetRight.x - entryLeft.x);
  expect(compactWidth).toBeGreaterThan(12);
  const entryCenter = {
    x: (entryLeft.x + targetRight.x) / 2,
    y: entryLeft.y,
  };

  await expect.poll(async () => (await drawingSnapshot(page)).selectedDrawingId)
    .toBe(drawing.id);

  const before = (await drawingSnapshot(page)).drawings[0].points;
  const beforeGeometry = {
    timeWidth: before[1].time - before[0].time,
    stopTimeWidth: before[2].time - before[0].time,
    targetOffset: before[1].price - before[0].price,
    stopOffset: before[2].price - before[0].price,
  };

  await page.mouse.move(entryCenter.x, entryCenter.y);
  await page.mouse.down();
  await expect.poll(async () => (await drawingSnapshot(page)).machineState)
    .toBe("MovingDrawing");
  expect((await drawingSnapshot(page)).machineState).not.toBe("ResizingHandle");
  await page.mouse.move(entryCenter.x + 52, entryCenter.y + 28, { steps: 4 });
  await page.mouse.up();

  await expect.poll(async () => (await drawingSnapshot(page)).machineState).toBe("Idle");
  const after = (await drawingSnapshot(page)).drawings[0].points;
  expect(after).not.toEqual(before);
  expect(after[1].time - after[0].time).toBe(beforeGeometry.timeWidth);
  expect(after[2].time - after[0].time).toBe(beforeGeometry.stopTimeWidth);
  expect(after[1].price - after[0].price).toBeCloseTo(beforeGeometry.targetOffset, 10);
  expect(after[2].price - after[0].price).toBeCloseTo(beforeGeometry.stopOffset, 10);
});

test("placing Long and Short positions keeps Chart open and explains the prepared Trade ticket", async ({ page }) => {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const plans = [
    { name: "Long position", tool: "long", title: "Long ticket prepared", x: 0.32 },
    { name: "Short position", tool: "short", title: "Short ticket prepared", x: 0.62 },
  ] as const;

  for (const [index, plan] of plans.entries()) {
    await page.getByRole("button", { name: "Long position", exact: true }).first().click();
    await page.getByRole("button", { name: new RegExp(`^${plan.name}\\b`) }).last().click();
    await page.mouse.click(
      pane.x + pane.width * plan.x,
      pane.y + pane.height * 0.5,
    );

    await expect.poll(async () => (await drawingSnapshot(page)).drawings[index]?.tool)
      .toBe(plan.tool);
    await expect(page.getByRole("button", { name: "Chart", exact: true }))
      .toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("button", { name: "Trade", exact: true }))
      .not.toHaveAttribute("aria-current", "page");

    const toast = page.locator("[data-toast]").filter({ hasText: plan.title });
    await expect(toast).toBeVisible();
    await expect(toast).toContainText("No order was submitted.");
    await expect(toast).toContainText("open Trade when you’re ready");
  }
});

test("one-click Long position stays visible near the pane right and top edges", async ({ page }) => {
  await page.evaluate(() => window.__chartInteractionTest!.setBarSpacing(1.5));
  await expect.poll(async () =>
    (await page.evaluate(() => window.__chartInteractionTest!.snapshot())).barSpacing,
  ).toBe(1.5);
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const creationPoint = {
    x: pane.x + pane.width * 0.9,
    y: pane.y + pane.height * 0.08,
  };

  await page.getByRole("button", { name: "Long position", exact: true }).first().click();
  await page.getByRole("button", { name: /^Long position\b/ }).last().click();
  await page.mouse.click(creationPoint.x, creationPoint.y);
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(1);

  const created = await drawingSnapshot(page);
  const drawing = created.drawings[0];
  const projected = await page.evaluate(
    (id) => window.__drawingInteractionTest!.projectDrawing(id),
    drawing.id,
  );
  expect(projected).not.toBeNull();
  const [entry, target, stop] = projected!;
  const canvasRight = created.canvas.x + created.canvas.width;
  expect(target.x - entry.x).toBeGreaterThan(12);
  expect(target.x).toBeLessThanOrEqual(canvasRight - 8);
  expect(target.y).toBeGreaterThanOrEqual(pane.y);
  expect(target.y).toBeLessThanOrEqual(pane.y + pane.height);
  expect(stop.y).toBeGreaterThanOrEqual(pane.y);
  expect(stop.y).toBeLessThanOrEqual(pane.y + pane.height);
});

async function exerciseTrendlineTransaction(page: Page) {
  await page.evaluate(() => window.__drawingInteractionTest!.clear());
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const start = { x: pane.x + pane.width * 0.3, y: pane.y + pane.height * 0.65 };
  const end = { x: pane.x + pane.width * 0.62, y: pane.y + pane.height * 0.35 };

  await page.getByRole("button", { name: "Trend line", exact: true }).click();
  await page.getByRole("button", { name: /^Trendline\b/ }).click();
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(end.x, end.y);

  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(1);
  const created = await drawingSnapshot(page);
  expect(created.drawings[0].tool).toBe("trendline");
  const projected = await page.evaluate(
    (id) => window.__drawingInteractionTest!.projectDrawing(id),
    created.drawings[0].id,
  );
  expect(projected).not.toBeNull();
  const [projectedStart, projectedEnd] = projected!;
  const selectionPoint = {
    x: projectedStart.x + (projectedEnd.x - projectedStart.x) * 0.75,
    y: projectedStart.y + (projectedEnd.y - projectedStart.y) * 0.75,
  };

  if (created.activeTool !== "crosshair") {
    await page.getByRole("button", { name: "Cursor", exact: true }).click();
    await page.getByRole("button", { name: /^Cross\b/ }).last().click();
  }
  // The midpoint owns inline text editing, so selection and drag deliberately
  // use body points away from that overlay.
  await page.mouse.click(selectionPoint.x, selectionPoint.y);
  await expect.poll(async () => (await drawingSnapshot(page)).selectedDrawingId)
    .not.toBeNull();

  const selectedProjection = await page.evaluate(
    (id) => window.__drawingInteractionTest!.projectDrawing(id),
    created.drawings[0].id,
  );
  const [selectedStart, selectedEnd] = selectedProjection!;
  const dragPoint = {
    x: selectedStart.x + (selectedEnd.x - selectedStart.x) * 0.18,
    y: selectedStart.y + (selectedEnd.y - selectedStart.y) * 0.18,
  };
  const pointInspection = await page.evaluate(
    ({ x, y }) => window.__drawingInteractionTest!.inspectClientPoint(x, y),
    dragPoint,
  );
  expect(pointInspection.insideCanvas).toBe(true);
  expect(pointInspection.overDrawingUi).toBe(false);
  expect(pointInspection.hits.some((hit) => hit.id === created.drawings[0].id)).toBe(true);

  const beforeMove = (await drawingSnapshot(page)).drawings[0].points;
  await page.mouse.move(dragPoint.x, dragPoint.y);
  await page.mouse.down();
  await expect.poll(async () => (await drawingSnapshot(page)).machineState)
    .toBe("MovingDrawing");
  await page.mouse.move(dragPoint.x + 48, dragPoint.y + 24, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[0].points)
    .not.toEqual(beforeMove);
  const afterMove = (await drawingSnapshot(page)).drawings[0].points;

  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[0].points)
    .toEqual(beforeMove);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[0].points)
    .toEqual(afterMove);

  await page.keyboard.press("Delete");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(0);
}

test("trendline transaction is stable and preserves chart interaction", async ({ page }) => {
  test.setTimeout(120_000);
  for (let iteration = 0; iteration < 3; iteration++) {
    await exerciseTrendlineTransaction(page);
  }

  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const beforeZoom = chart.viewport.revision;
  await page.mouse.move(pane.x + pane.width * 0.5, pane.y + pane.height * 0.5);
  await page.mouse.wheel(0, -400);
  await expect.poll(async () =>
    page.evaluate(() => window.__chartInteractionTest!.snapshot().viewport.revision),
  ).toBeGreaterThan(beforeZoom);
});

test("creation cancellation and explicit freeform completion are transactional", async ({ page }) => {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const first = { x: pane.x + pane.width * 0.25, y: pane.y + pane.height * 0.6 };
  const second = { x: pane.x + pane.width * 0.55, y: pane.y + pane.height * 0.35 };

  await page.getByRole("button", { name: "Trend line", exact: true }).click();
  await page.getByRole("button", { name: /^Trendline\b/ }).click();
  await page.mouse.click(first.x, first.y);
  await expect.poll(async () => (await drawingSnapshot(page)).machineState).toBe("Drawing");
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await drawingSnapshot(page)).machineState).toBe("Idle");
  expect((await drawingSnapshot(page)).drawings).toHaveLength(0);
  expect((await drawingSnapshot(page)).activeTool).toBe("crosshair");

  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  await page.getByRole("button", { name: /^Path\b/ }).click();
  await page.mouse.click(first.x, first.y);
  await page.mouse.click(second.x, second.y);
  await expect.poll(async () => (await drawingSnapshot(page)).machineState).toBe("Drawing");
  await page.mouse.click(second.x + 20, second.y + 20, { button: "right" });
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(1);
  expect((await drawingSnapshot(page)).drawings[0].tool).toBe("path");

  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(0);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(1);

  await page.evaluate(() => window.__drawingInteractionTest!.clear());
  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  await page.getByRole("button", { name: /^Triangle\b/ }).click();
  await page.mouse.click(first.x, first.y);
  await expect.poll(async () => (await drawingSnapshot(page)).machineState).toBe("Drawing");
  await page.getByRole("button", { name: "Cursor", exact: true }).click();
  await page.getByRole("button", { name: /^Cross\b/ }).last().click();
  await expect.poll(async () => (await drawingSnapshot(page)).machineState).toBe("Idle");
  expect((await drawingSnapshot(page)).drawings).toHaveLength(0);
});

test("rectangle completion releases one-shot creation before hover movement", async ({ page }) => {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const first = { x: pane.x + pane.width * 0.24, y: pane.y + pane.height * 0.68 };
  const second = { x: pane.x + pane.width * 0.56, y: pane.y + pane.height * 0.38 };
  const hover = { x: pane.x + pane.width * 0.76, y: pane.y + pane.height * 0.2 };
  const keepDrawing = page.getByRole("button", { name: "Keep drawing", exact: true });
  if ((await keepDrawing.getAttribute("class"))?.includes("bg-brand/10")) {
    await keepDrawing.click();
  }

  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  await page.getByRole("button", { name: /^Rectangle\b/ }).last().click();
  await page.mouse.click(first.x, first.y);
  await page.mouse.move(second.x, second.y, { steps: 4 });
  await page.mouse.click(second.x, second.y);

  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(1);
  await expect.poll(async () => (await drawingSnapshot(page)).machineState).toBe("Idle");
  await expect.poll(async () => (await drawingSnapshot(page)).activeTool).toBe("crosshair");
  const committed = (await drawingSnapshot(page)).drawings[0].points;

  await page.mouse.move(hover.x, hover.y, { steps: 8 });
  await page.evaluate(() => new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  ));
  const afterHover = await drawingSnapshot(page);
  expect(afterHover.machineState).toBe("Idle");
  expect(afterHover.activeTool).toBe("crosshair");
  expect(afterHover.drawings).toHaveLength(1);
  expect(afterHover.drawings[0].points).toEqual(committed);
});

test("keep-drawing rectangle waits for a new pointerdown after commit", async ({ page }) => {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const first = { x: pane.x + pane.width * 0.22, y: pane.y + pane.height * 0.7 };
  const second = { x: pane.x + pane.width * 0.5, y: pane.y + pane.height * 0.42 };
  const hover = { x: pane.x + pane.width * 0.74, y: pane.y + pane.height * 0.22 };
  const keepDrawing = page.getByRole("button", { name: "Keep drawing", exact: true });
  if (!(await keepDrawing.getAttribute("class"))?.includes("bg-brand/10")) {
    await keepDrawing.click();
  }

  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  await page.getByRole("button", { name: /^Rectangle\b/ }).last().click();
  await page.mouse.click(first.x, first.y);
  await page.mouse.move(second.x, second.y, { steps: 4 });
  await page.mouse.click(second.x, second.y);
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(1);
  await expect.poll(async () => (await drawingSnapshot(page)).machineState).toBe("Idle");
  await expect.poll(async () => (await drawingSnapshot(page)).activeTool).toBe("rectangle");

  await page.mouse.move(hover.x, hover.y, { steps: 8 });
  await page.evaluate(() => new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  ));
  const afterHover = await drawingSnapshot(page);
  expect(afterHover.machineState).toBe("Idle");
  expect(afterHover.drawings).toHaveLength(1);

  await keepDrawing.click();
});

test("keep-drawing does not reuse the finishing pointer for another rectangle", async ({ page }) => {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const first = { x: pane.x + pane.width * 0.2, y: pane.y + pane.height * 0.72 };
  const second = { x: pane.x + pane.width * 0.48, y: pane.y + pane.height * 0.44 };
  const whileHeld = { x: pane.x + pane.width * 0.74, y: pane.y + pane.height * 0.22 };
  const keepDrawing = page.getByRole("button", { name: "Keep drawing", exact: true });
  if (!(await keepDrawing.getAttribute("class"))?.includes("bg-brand/10")) {
    await keepDrawing.click();
  }

  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  await page.getByRole("button", { name: /^Rectangle\b/ }).last().click();
  await page.mouse.click(first.x, first.y);
  await page.mouse.move(second.x, second.y, { steps: 4 });
  await page.mouse.down();
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(1);
  await page.mouse.move(whileHeld.x, whileHeld.y, { steps: 8 });
  await page.mouse.up();
  await page.evaluate(() => new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  ));

  const afterRelease = await drawingSnapshot(page);
  expect(afterRelease.drawings).toHaveLength(1);
  expect(afterRelease.machineState).toBe("Idle");
  expect(afterRelease.activeTool).toBe("rectangle");
  await keepDrawing.click();
});

test("rectangle commit does not reopen creation while the finishing pointer is held", async ({ page }) => {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const first = { x: pane.x + pane.width * 0.2, y: pane.y + pane.height * 0.72 };
  const second = { x: pane.x + pane.width * 0.48, y: pane.y + pane.height * 0.44 };
  const whileHeld = { x: pane.x + pane.width * 0.72, y: pane.y + pane.height * 0.24 };
  const keepDrawing = page.getByRole("button", { name: "Keep drawing", exact: true });
  if ((await keepDrawing.getAttribute("class"))?.includes("bg-brand/10")) {
    await keepDrawing.click();
  }

  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  await page.getByRole("button", { name: /^Rectangle\b/ }).last().click();
  await page.mouse.click(first.x, first.y);
  await page.mouse.move(second.x, second.y, { steps: 4 });
  await page.mouse.down();
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(1);
  await expect.poll(async () => (await drawingSnapshot(page)).machineState).toBe("Idle");
  await page.mouse.move(whileHeld.x, whileHeld.y, { steps: 8 });
  await page.evaluate(() => new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  ));
  expect((await drawingSnapshot(page)).drawings).toHaveLength(1);
  expect((await drawingSnapshot(page)).machineState).toBe("Idle");
  await page.mouse.up();
});

test("rectangle drag-release commits and exits creation mode", async ({ page }) => {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const start = { x: pane.x + pane.width * 0.22, y: pane.y + pane.height * 0.7 };
  const end = { x: pane.x + pane.width * 0.58, y: pane.y + pane.height * 0.34 };
  const hover = { x: pane.x + pane.width * 0.78, y: pane.y + pane.height * 0.2 };
  const keepDrawing = page.getByRole("button", { name: "Keep drawing", exact: true });
  if ((await keepDrawing.getAttribute("class"))?.includes("bg-brand/10")) {
    await keepDrawing.click();
  }

  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  await page.getByRole("button", { name: /^Rectangle\b/ }).last().click();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();

  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(1);
  await expect.poll(async () => (await drawingSnapshot(page)).machineState).toBe("Idle");
  await expect.poll(async () => (await drawingSnapshot(page)).activeTool).toBe("crosshair");
  const committed = (await drawingSnapshot(page)).drawings[0].points;

  await page.mouse.move(hover.x, hover.y, { steps: 8 });
  await page.evaluate(() => new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  ));
  const afterHover = await drawingSnapshot(page);
  expect(afterHover.drawings).toHaveLength(1);
  expect(afterHover.machineState).toBe("Idle");
  expect(afterHover.drawings[0].points).toEqual(committed);
});

test("two-point drag follows owned pointer when buttons telemetry is zero", async ({ page }) => {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const start = { x: pane.x + pane.width * 0.26, y: pane.y + pane.height * 0.66 };
  const end = { x: pane.x + pane.width * 0.62, y: pane.y + pane.height * 0.3 };
  const keepDrawing = page.getByRole("button", { name: "Keep drawing", exact: true });
  if ((await keepDrawing.getAttribute("class"))?.includes("bg-brand/10")) {
    await keepDrawing.click();
  }

  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  await page.getByRole("button", { name: /^Rectangle\b/ }).last().click();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y);
    target?.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "mouse",
      buttons: 0,
      pressure: 0,
      clientX: x,
      clientY: y,
    }));
    target?.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "mouse",
      buttons: 0,
      pressure: 0,
      clientX: x,
      clientY: y,
    }));
  }, end);
  await page.mouse.up();

  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(1);
  await expect.poll(async () => (await drawingSnapshot(page)).machineState).toBe("Idle");
  await expect.poll(async () => (await drawingSnapshot(page)).activeTool).toBe("crosshair");
});

test("eraser is undoable and pass-through modes never start creation", async ({ page }) => {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const start = { x: pane.x + pane.width * 0.28, y: pane.y + pane.height * 0.62 };
  const end = { x: pane.x + pane.width * 0.58, y: pane.y + pane.height * 0.32 };

  await page.getByRole("button", { name: "Trend line", exact: true }).click();
  await page.getByRole("button", { name: /^Trendline\b/ }).click();
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(end.x, end.y);
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(1);

  await page.getByRole("button", { name: "Cursor", exact: true }).click();
  await page.getByRole("button", { name: /^Eraser\b/ }).click();
  await page.mouse.click(
    start.x + (end.x - start.x) * 0.75,
    start.y + (end.y - start.y) * 0.75,
  );
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(0);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(1);

  await page.getByRole("button", { name: "Cursor", exact: true }).click();
  await page.getByRole("button", { name: /^Cross\b/ }).click();
  await page.mouse.click(start.x, start.y);
  const snapshot = await drawingSnapshot(page);
  expect(snapshot.machineState).toBe("Idle");
  expect(snapshot.drawings).toHaveLength(1);
});

test("resize, pointer cancellation, and symbol cancellation preserve transaction boundaries", async ({ page }) => {
  test.setTimeout(120_000);
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const start = { x: pane.x + pane.width * 0.3, y: pane.y + pane.height * 0.65 };
  const end = { x: pane.x + pane.width * 0.62, y: pane.y + pane.height * 0.35 };

  await page.getByRole("button", { name: "Trend line", exact: true }).click();
  await page.getByRole("button", { name: /^Trendline\b/ }).click();
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(end.x, end.y);
  const created = await drawingSnapshot(page);
  const original = created.drawings[0].points;
  const projected = await page.evaluate(
    (id) => window.__drawingInteractionTest!.projectDrawing(id),
    created.drawings[0].id,
  );
  expect(projected).not.toBeNull();

  await page.getByRole("button", { name: "Cursor", exact: true }).click();
  await page.getByRole("button", { name: /^Cross\b/ }).last().click();
  await page.mouse.move(projected![1].x, projected![1].y);
  await page.mouse.down();
  await expect.poll(async () => (await drawingSnapshot(page)).machineState).toBe("ResizingHandle");
  await page.mouse.move(projected![1].x + 40, projected![1].y - 20, { steps: 3 });
  await page.mouse.up();
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[0].points).not.toEqual(original);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[0].points).toEqual(original);

  const body = {
    x: projected![0].x + (projected![1].x - projected![0].x) * 0.75,
    y: projected![0].y + (projected![1].y - projected![0].y) * 0.75,
  };
  await page.mouse.move(body.x, body.y);
  await page.mouse.down();
  await expect.poll(async () => (await drawingSnapshot(page)).machineState).toBe("MovingDrawing");
  await page.mouse.move(body.x + 30, body.y + 20);
  await page.evaluate(() =>
    document.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 1 })),
  );
  await expect.poll(async () => (await drawingSnapshot(page)).machineState).toBe("Idle");
  expect((await drawingSnapshot(page)).drawings[0].points).toEqual(original);
  await page.mouse.up();

  await page.evaluate(() => window.__drawingInteractionTest!.clear());
  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  await page.getByRole("button", { name: /^Brush\b/ }).click();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 30, start.y + 20);
  await expect.poll(async () => (await drawingSnapshot(page)).machineState).toBe("Drawing");
  await page.evaluate(() =>
    document.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 1 })),
  );
  await expect.poll(async () => (await drawingSnapshot(page)).machineState).toBe("Idle");
  expect((await drawingSnapshot(page)).drawings).toHaveLength(0);
  await page.mouse.up();

  await page.getByRole("button", { name: "Trend line", exact: true }).click();
  await page.getByRole("button", { name: /^Trendline\b/ }).click();
  await page.mouse.click(start.x, start.y);
  await expect.poll(async () => (await drawingSnapshot(page)).machineState).toBe("Drawing");
  await page.evaluate(() => window.__drawingInteractionTest!.changeSymbol("PHASE2_CANCEL_TEST"));
  await expect.poll(async () => (await drawingSnapshot(page)).machineState).toBe("Idle");
  expect((await drawingSnapshot(page)).activeTool).toBe("crosshair");
  expect((await drawingSnapshot(page)).drawings).toHaveLength(0);
});

test("standalone and attached text edits each produce one undoable command", async ({ page }) => {
  const chart = await page.evaluate(() => window.__chartInteractionTest!.snapshot());
  const pane = chart.paneBoxes[0];
  const start = { x: pane.x + pane.width * 0.25, y: pane.y + pane.height * 0.6 };
  const end = { x: pane.x + pane.width * 0.52, y: pane.y + pane.height * 0.35 };

  await page.getByRole("button", { name: "Text", exact: true }).click();
  await page.getByRole("button", { name: /^Text\b/ }).last().click();
  await page.mouse.click(start.x, start.y);
  const editor = page.getByPlaceholder("Enter text...");
  await editor.fill("Standalone note");
  await editor.press("Enter");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[0]?.text).toBe("Standalone note");
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(0);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings.length).toBe(1);

  await page.evaluate(() => window.__drawingInteractionTest!.clear());
  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  await page.getByRole("button", { name: /^Rectangle\b/ }).last().click();
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(end.x, end.y);
  await page.getByRole("button", { name: "Cursor", exact: true }).click();
  await page.getByRole("button", { name: /^Cross\b/ }).last().click();
  await page.mouse.click((start.x + end.x) / 2, (start.y + end.y) / 2);
  await page.getByPlaceholder("Enter text...").fill("Attached label");
  await page.getByPlaceholder("Enter text...").press("Enter");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[0]?.text).toBe("Attached label");
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[0]?.text ?? "").toBe("");
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(async () => (await drawingSnapshot(page)).drawings[0]?.text).toBe("Attached label");
});
