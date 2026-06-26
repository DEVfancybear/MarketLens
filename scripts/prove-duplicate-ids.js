/**
 * Runtime evidence script — proves that duplicated/empty drawing ids
 * cause cross-contamination in chartStore.
 *
 * Run: node scripts/prove-duplicate-ids.js
 */
const { create } = require("zustand");

let counter = 0;
function uid(prefix) {
  return prefix + "_" + Date.now() + "_" + ++counter;
}

// Exact mirror of chartStore.ts drawing methods
const useChartStore = create((set, get) => ({
  drawings: [],
  selectedDrawingId: null,

  addDrawing: function (d) {
    const top = get().drawings.reduce((m, x) => Math.max(m, x.zIndex || 0), 0);
    const drawing = Object.assign(
      { visible: true, locked: false, zIndex: top + 1 },
      d,
    );
    const drawings = [...get().drawings, drawing];

    // INSTRUMENTATION
    if (drawing.id === "" || drawing.id === undefined || drawing.id === null) {
      console.log(
        '[addDrawing] INVALID ID: "' +
          drawing.id +
          '" (tool=' +
          drawing.tool +
          ")",
      );
    }
    set({ drawings: drawings, selectedDrawingId: drawing.id });
  },

  updateDrawing: function (id, patch) {
    const before = get().drawings;
    const matched = before.filter(function (d) {
      return d.id === id;
    });
    const drawings = before.map(function (d) {
      return d.id === id ? Object.assign({}, d, patch) : d;
    });
    // INSTRUMENTATION
    console.log(
      '[updateDrawing] id="' +
        id +
        '" | matched=' +
        matched.length +
        " drawings | tools=[" +
        matched
          .map(function (d) {
            return d.tool;
          })
          .join(", ") +
        "]",
    );
    if (matched.length > 1) {
      console.log(
        "[updateDrawing] CROSS-CONTAMINATION: " +
          matched.length +
          ' drawings share id "' +
          id +
          '" -- ALL updated!',
      );
    }
    set({ drawings: drawings });
  },

  removeDrawing: function (id) {
    const before = get().drawings;
    const removed = before.filter(function (d) {
      return d.id === id;
    });
    const drawings = before.filter(function (d) {
      return d.id !== id;
    });
    // INSTRUMENTATION
    console.log(
      '[removeDrawing] id="' +
        id +
        '" | removed=' +
        removed.length +
        " drawings | remaining=" +
        drawings.length,
    );
    if (removed.length > 1) {
      console.log(
        "[removeDrawing] MASS-DELETE: " +
          removed.length +
          ' drawings share id "' +
          id +
          '" -- ALL removed!',
      );
    }
    set({ drawings: drawings, selectedDrawingId: null });
  },

  duplicateDrawing: function (id) {
    const src = get().drawings.find(function (d) {
      return d.id === id;
    });
    if (!src) return;
    const top = get().drawings.reduce(function (m, x) {
      return Math.max(m, x.zIndex || 0);
    }, 0);
    const newId = uid("dw");
    const copy = Object.assign({}, src, {
      id: newId,
      zIndex: top + 1,
      points: src.points.map(function (p) {
        return Object.assign({}, p);
      }),
    });
    const drawings = [...get().drawings, copy];
    // INSTRUMENTATION
    console.log(
      '[duplicateDrawing] originalId="' +
        id +
        '" -> newId="' +
        newId +
        '" | different=' +
        (id !== newId),
    );
    set({ drawings: drawings, selectedDrawingId: copy.id });
  },
}));

function drawIds() {
  return useChartStore.getState().drawings.map(function (d) {
    return '"' + d.id + '"';
  });
}
function drawTools() {
  return useChartStore.getState().drawings.map(function (d) {
    return d.tool;
  });
}

// ========================================================================
// TEST 1: Initial state
// ========================================================================
console.log("\n=== TEST 1: Initial state ===");
console.log("drawings count:", useChartStore.getState().drawings.length);
console.log("ids:", drawIds());

// ========================================================================
// TEST 2: Create two normal drawings
// ========================================================================
console.log("\n=== TEST 2: Create two normal drawings ===");
var s = useChartStore.getState();

s.addDrawing({
  id: uid("dw"),
  tool: "trendline",
  color: "#2962ff",
  lineWidth: 1.5,
  points: [
    { time: 1000, price: 100 },
    { time: 2000, price: 200 },
  ],
});

s.addDrawing({
  id: uid("dw"),
  tool: "rectangle",
  color: "#ef5350",
  lineWidth: 1.5,
  points: [
    { time: 1500, price: 150 },
    { time: 2500, price: 250 },
  ],
});

var ids = drawIds();
var tools = drawTools();
console.log("All ids: [" + ids.join(", ") + "]");
console.log("All tools: [" + tools.join(", ") + "]");

var allDrawings = useChartStore.getState().drawings;
var dupes = allDrawings
  .map(function (d) {
    return d.id;
  })
  .filter(function (id, i, arr) {
    return arr.indexOf(id) !== i;
  });
console.log("Duplicate ids: " + (dupes.length > 0 ? dupes : "NONE"));
console.log(
  "Empty ids: " +
    allDrawings.filter(function (d) {
      return d.id === "";
    }).length,
);

// ========================================================================
// TEST 3: Simulate Ctrl+D exactly as DrawingLayer.tsx:234-249 does
// ========================================================================
console.log("\n=== TEST 3: Simulate Ctrl+D (DrawingLayer.tsx:234-249) ===");
console.log("Exact code path:");
console.log("  L240: storeRef.current.duplicateDrawing(d.id);");
console.log(
  "  L241-247: execute(new DuplicateDrawingCommand(..., {...d, id:''}))",
);
console.log("  DuplicateDrawingCommand.execute() calls addFn({...d, id:''})");

var currentDrawings = useChartStore.getState().drawings;
var drawingA = currentDrawings[0];
console.log('\nDrawing A: id="' + drawingA.id + '" tool=' + drawingA.tool);

// Line 240
useChartStore.getState().duplicateDrawing(drawingA.id);

// Lines 241-247: DuplicateDrawingCommand stores { ...d, id: "" }
// then execute() calls addFn(this.drawing) = addDrawing({...d, id:""})
useChartStore.getState().addDrawing(Object.assign({}, drawingA, { id: "" }));

var afterCtrlD = useChartStore.getState().drawings;
console.log("\nDrawings after Ctrl+D:");
afterCtrlD.forEach(function (d, i) {
  console.log(
    "  [" +
      i +
      '] id="' +
      d.id +
      '" tool=' +
      d.tool +
      " valid=" +
      (d.id !== "" && d.id !== undefined),
  );
});

var afterEmpty = afterCtrlD.filter(function (d) {
  return d.id === "";
});
console.log(
  "\nEmpty ids: " +
    afterEmpty.length +
    ' ["' +
    afterEmpty
      .map(function (d) {
        return d.id;
      })
      .join('", "') +
    '"]',
);
console.log("Total drawings: " + afterCtrlD.length);

// ========================================================================
// TEST 4: Press Ctrl+D AGAIN on a different drawing
// ========================================================================
console.log("\n=== TEST 4: Ctrl+D pressed AGAIN (2nd duplicate) ===");
var current2 = useChartStore.getState().drawings;
var drawingB = current2[1]; // the rectangle
console.log('Drawing B: id="' + drawingB.id + '" tool=' + drawingB.tool);

useChartStore.getState().duplicateDrawing(drawingB.id);
useChartStore.getState().addDrawing(Object.assign({}, drawingB, { id: "" }));

var beforeUpdate = useChartStore.getState().drawings;
var emptyOnes = beforeUpdate.filter(function (d) {
  return d.id === "";
});
console.log("\nDrawings with id='': " + emptyOnes.length);
console.log(
  "Their tools: [" +
    emptyOnes
      .map(function (d) {
        return d.tool;
      })
      .join(", ") +
    "]",
);
console.log("Total drawings: " + beforeUpdate.length);

// ========================================================================
// TEST 5: PROVE updateDrawing cross-contamination
// ========================================================================
console.log("\n=== TEST 5: Prove updateDrawing() cross-contamination ===");
console.log("Simulating drag of drawing with id='':");
console.log("  DrawingInteractionManager.handleUp()");
console.log("  -> updateDrawing('', { points: [{time:9999, price:9999}] })");

useChartStore.getState().updateDrawing("", {
  points: [{ time: 9999, price: 9999 }],
});

var afterUpdate = useChartStore.getState().drawings;
var stillEmpty = afterUpdate.filter(function (d) {
  return d.id === "";
});
console.log("\nAfter drag: " + stillEmpty.length + " drawings with id=''");
stillEmpty.forEach(function (d, i) {
  console.log(
    "  [" +
      i +
      "] tool=" +
      d.tool +
      " points=[" +
      JSON.stringify(d.points) +
      "]",
  );
});

var others = afterUpdate.filter(function (d) {
  return d.id !== "";
});
console.log("\nNon-empty drawings (should be untouched):");
others.forEach(function (d, i) {
  console.log(
    "  [" +
      i +
      '] id="' +
      d.id +
      '" tool=' +
      d.tool +
      " points=[" +
      JSON.stringify(d.points) +
      "]",
  );
});

// Verify
var allCorrupted = stillEmpty.every(function (d) {
  return (
    d.points.length > 0 &&
    d.points[0].time === 9999 &&
    d.points[0].price === 9999
  );
});
console.log(
  "\nAll empty-id drawings share same corrupted points: " + allCorrupted,
);

// ========================================================================
// TEST 6: PROVE removeDrawing mass-delete
// ========================================================================
console.log("\n=== TEST 6: Prove removeDrawing() mass-delete ===");
var beforeRemove = useChartStore.getState().drawings;
console.log("Before remove: " + beforeRemove.length + " drawings");

useChartStore.getState().removeDrawing("");

var afterRemove = useChartStore.getState().drawings;
console.log("After remove: " + afterRemove.length + " drawings");
console.log(
  "Drawings removed: " +
    (beforeRemove.length - afterRemove.length) +
    " (all empty-id drawings)",
);

// ========================================================================
// TEST 7: Final state
// ========================================================================
console.log("\n=== TEST 7: Final state audit ===");
var final = useChartStore.getState().drawings;
console.log("Total drawings: " + final.length);
final.forEach(function (d, i) {
  console.log(
    "  [" +
      i +
      '] id="' +
      d.id +
      '" tool=' +
      d.tool +
      " empty=" +
      (d.id === ""),
  );
});

var allIds = final.map(function (d) {
  return d.id;
});
var allDupes = allIds.filter(function (id, i) {
  return allIds.indexOf(id) !== i;
});
console.log(
  "\nEmpty ids: " +
    allIds.filter(function (id) {
      return id === "";
    }).length,
);
console.log(
  "Undefined ids: " +
    allIds.filter(function (id) {
      return id === undefined;
    }).length,
);
console.log("Duplicates: " + (allDupes.length > 0 ? allDupes : "NONE"));

// ========================================================================
// VERDICT
// ========================================================================
console.log("\n===========================================================");
console.log("VERDICT");
console.log("===========================================================");
console.log("1. DuplicateDrawingCommand stores drawing with id=''");
console.log(
  "2. DuplicateDrawingCommand.execute() calls addDrawing({...,id:''})",
);
console.log(
  "3. addDrawing stores { ...d } -- uses d.id='' as-is (no uid generation)",
);
console.log("4. Multiple drawings now share id=''");
console.log(
  "5. updateDrawing('', patch) matches ALL d.id === '' -> updates ALL",
);
console.log("6. removeDrawing('') matches ALL d.id === '' -> removes ALL");
console.log("");
console.log("Ctrl+D is CONFIRMED as the primary root cause.");
console.log(
  "Evidence: one updateDrawing call modified " +
    stillEmpty.length +
    " drawings.",
);
console.log("===========================================================");
