import assert from "node:assert/strict";
import test from "node:test";
import {
  EN_UI_COPY,
  translateDocumentText,
  VI_UI_COPY,
} from "../../src/i18n/documentLocalization";
import {
  drawingGroupName,
  drawingToolName,
  translate,
  VI_DRAWING_TOOL_NAMES,
} from "../../src/i18n/localization";
import {
  DRAWING_TOOL_GROUPS,
  DRAWING_TOOL_MANIFEST,
} from "../../src/types/drawingToolManifest";

test("all drawing tools and groups have a Vietnamese display name", () => {
  for (const entry of DRAWING_TOOL_MANIFEST) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(VI_DRAWING_TOOL_NAMES, entry.id),
      entry.id,
    );
    const localized = drawingToolName("vi", entry.id, entry.displayName);
    assert.ok(localized.trim(), entry.id);
  }
  for (const group of DRAWING_TOOL_GROUPS) {
    const localized = drawingGroupName("vi", group.id, group.label);
    assert.ok(localized.trim(), group.id);
    assert.notEqual(localized, group.label, group.id);
  }
});

test("typed UI keys are complete in English and Vietnamese", () => {
  assert.equal(translate("en", "drawing.keepDrawing"), "Keep drawing");
  assert.equal(translate("vi", "drawing.keepDrawing"), "Liên tục vẽ");
  assert.equal(
    translate("vi", "drawing.removeConfirm", { count: 3 }),
    "Xóa tất cả 3 hình vẽ?",
  );
  assert.equal(translate("en", "alerts.clearAll"), "Clear all");
  assert.equal(
    translate("vi", "alerts.clearConfirm", { count: 4 }),
    "Xóa toàn bộ 4 cảnh báo đang hoạt động?",
  );
});

test("legacy UI boundary translates exact copy and count patterns", () => {
  assert.equal(translateDocumentText("vi", "Indicators"), "Chỉ báo");
  assert.equal(
    translateDocumentText("vi", "  12 instruments  "),
    "  12 công cụ giao dịch  ",
  );
  assert.equal(
    translateDocumentText("en", "Hướng dẫn cài đặt"),
    "Setup guide",
  );
});

test("compatibility catalogs contain no empty or identity entries", () => {
  for (const [source, target] of [
    ...Object.entries(VI_UI_COPY),
    ...Object.entries(EN_UI_COPY),
  ]) {
    assert.ok(source.trim());
    assert.ok(target.trim(), source);
    assert.notEqual(source, target);
  }
});
