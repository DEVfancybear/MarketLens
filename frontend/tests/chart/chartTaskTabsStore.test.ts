import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_CHART_TASKS,
  activateChartTask,
  addChartTask,
  chartTaskDropEdge,
  closeChartTask,
  createInitialChartTaskTabs,
  moveChartTask,
  normalizeChartTaskTabsDocument,
  shouldActivateChartTaskDrag,
  updateChartTask,
  type ChartTaskTabsDocument,
} from "../../src/store/chartTaskTabsStore";

const selection = { symbol: "EURUSD", timeframe: "15m" as const };

test("seeds one task from the legacy active workspace", () => {
  const document = createInitialChartTaskTabs(selection, {
    taskId: "task-1",
    drawingContextId: "scope-1",
  });

  assert.equal(document.version, 1);
  assert.equal(document.revision, 0);
  assert.equal(document.activeTaskId, "task-1");
  assert.equal(document.tasks.length, 1);
  assert.equal(document.tasks[0]?.drawingContextId, "scope-1");
  assert.equal(document.tasks[0]?.workspace.chartLayoutPreset, "single");
  assert.equal(document.tasks[0]?.workspace.chartPanes[0]?.symbol, "EURUSD");
  assert.equal(document.tasks[0]?.workspace.chartPanes[0]?.timeframe, "15m");
});

test("normalization always returns one valid active task", () => {
  const malformed = {
    version: 1,
    revision: -5,
    activeTaskId: "missing",
    tasks: [
      {
        id: "duplicate",
        drawingContextId: "same",
        workspace: { version: 99 },
      },
      {
        id: "duplicate",
        drawingContextId: "same",
        workspace: null,
      },
    ],
  };
  const normalized = normalizeChartTaskTabsDocument(malformed, selection);
  assert.equal(normalized.version, 1);
  assert.equal(normalized.revision, 0);
  assert.equal(normalized.tasks.length, 1);
  assert.equal(normalized.activeTaskId, normalized.tasks[0]?.id);
  assert.equal(normalized.tasks[0]?.workspace.chartPanes[0]?.symbol, "EURUSD");
});

test("adds a fresh task to the right without copying scoped content", () => {
  const original = createInitialChartTaskTabs(selection, {
    taskId: "task-a",
    drawingContextId: "scope-a",
  });
  const next = addChartTask(
    original,
    { symbol: "XAUUSD", timeframe: "1H" },
    { taskId: "task-b", drawingContextId: "scope-b" },
  );

  assert.deepEqual(next.tasks.map((task) => task.id), ["task-a", "task-b"]);
  assert.equal(next.activeTaskId, "task-b");
  assert.equal(next.tasks[1]?.workspace.chartLayoutPreset, "single");
  assert.equal(next.tasks[1]?.workspace.replayLayoutMode, "single_chart");
  assert.deepEqual(next.tasks[1]?.workspace.alertChartOwners, {});
  assert.equal(next.tasks[1]?.workspace.chartPanes[0]?.symbol, "XAUUSD");
  assert.equal(next.tasks[1]?.workspace.chartPanes[0]?.timeframe, "1H");
  assert.equal(next.tasks[1]?.activeLayoutId, null);
  assert.notEqual(next.tasks[1]?.drawingContextId, next.tasks[0]?.drawingContextId);
});

test("refuses a thirteenth task without mutation", () => {
  const full = documentWithTasks(MAX_CHART_TASKS);
  const next = addChartTask(full, selection, {
    taskId: "task-overflow",
    drawingContextId: "scope-overflow",
  });
  assert.strictEqual(next, full);
});

test("captures outgoing and restores target workspace exactly", () => {
  let document = documentWithTasks(2);
  const workspace = structuredClone(document.tasks[0]!.workspace);
  workspace.chartLayoutPreset = "grid_2x2";
  workspace.replayLayoutMode = "all_charts";
  workspace.activeChartSlot = 3;
  workspace.chartPanes[3] = {
    ...workspace.chartPanes[3]!,
    symbol: "GBPUSD",
    timeframe: "1H",
    initialized: true,
  };
  document = updateChartTask(document, "task-0", workspace, "layout-9");
  const activated = activateChartTask(document, "task-1");

  assert.equal(activated.activeTaskId, "task-1");
  assert.deepEqual(activated.tasks[0]?.workspace, workspace);
  assert.equal(activated.tasks[0]?.activeLayoutId, "layout-9");
  assert.strictEqual(activateChartTask(activated, "missing"), activated);
});

test("closing active selects right then left neighbor", () => {
  let document = documentWithTasks(3);
  document = activateChartTask(document, "task-1");
  const closedMiddle = closeChartTask(document, "task-1");
  assert.deepEqual(closedMiddle.tasks.map((task) => task.id), ["task-0", "task-2"]);
  assert.equal(closedMiddle.activeTaskId, "task-2");

  const closedLast = closeChartTask(closedMiddle, "task-2");
  assert.deepEqual(closedLast.tasks.map((task) => task.id), ["task-0"]);
  assert.equal(closedLast.activeTaskId, "task-0");
});

test("closing inactive preserves active workspace and final task cannot close", () => {
  const document = activateChartTask(documentWithTasks(3), "task-2");
  const activeTask = document.tasks[2];
  const closed = closeChartTask(document, "task-0");
  assert.equal(closed.activeTaskId, "task-2");
  assert.strictEqual(closed.tasks.find((task) => task.id === "task-2"), activeTask);

  const one = createInitialChartTaskTabs(selection, {
    taskId: "only",
    drawingContextId: "only-scope",
  });
  assert.strictEqual(closeChartTask(one, "only"), one);
});

test("moves a task before or after without changing active identity", () => {
  const document = activateChartTask(documentWithTasks(3), "task-1");
  const taskRefs = new Map(document.tasks.map((task) => [task.id, task]));
  const moved = moveChartTask(document, "task-0", "task-2", "after");

  assert.deepEqual(moved.tasks.map((task) => task.id), ["task-1", "task-2", "task-0"]);
  assert.equal(moved.activeTaskId, "task-1");
  for (const task of moved.tasks) assert.strictEqual(task, taskRefs.get(task.id));
});

test("reorder boundary and same-target drops preserve document identity", () => {
  const document = documentWithTasks(3);
  assert.strictEqual(moveChartTask(document, "task-0", "task-0", "before"), document);
  assert.strictEqual(moveChartTask(document, "missing", "task-1", "before"), document);
  assert.strictEqual(moveChartTask(document, "task-0", "missing", "after"), document);
  assert.strictEqual(moveChartTask(document, "task-0", "task-1", "before"), document);
  assert.strictEqual(moveChartTask(document, "task-2", "task-1", "after"), document);
});

test("generated reorder permutations preserve every task exactly once", () => {
  const document = documentWithTasks(12);
  const expected = document.tasks.map((task) => task.id).sort();
  for (const source of document.tasks) {
    for (const target of document.tasks) {
      for (const edge of ["before", "after"] as const) {
        const moved = moveChartTask(document, source.id, target.id, edge);
        assert.deepEqual(moved.tasks.map((task) => task.id).sort(), expected);
        assert.equal(new Set(moved.tasks.map((task) => task.id)).size, 12);
        assert.equal(moved.activeTaskId, document.activeTaskId);
      }
    }
  }
});

test("horizontal drag threshold and drop edge match existing reorder behavior", () => {
  assert.equal(shouldActivateChartTaskDrag(10, 20, 13, 24), false);
  assert.equal(shouldActivateChartTaskDrag(10, 20, 16, 20), true);
  assert.equal(shouldActivateChartTaskDrag(10, 20, 10, 26), true);
  assert.equal(chartTaskDropEdge(124, 100, 50), "before");
  assert.equal(chartTaskDropEdge(125, 100, 50), "after");
});

function documentWithTasks(count: number): ChartTaskTabsDocument {
  let document = createInitialChartTaskTabs(selection, {
    taskId: "task-0",
    drawingContextId: "scope-0",
  });
  for (let index = 1; index < count; index += 1) {
    document = addChartTask(document, selection, {
      taskId: `task-${index}`,
      drawingContextId: `scope-${index}`,
    });
  }
  return activateChartTask(document, "task-0");
}
