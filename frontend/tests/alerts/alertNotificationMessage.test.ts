import assert from "node:assert/strict";
import { test } from "node:test";

import {
  alertConditionLabel,
  formatAlertNotificationMessage,
  formatAlertTime,
  formatAlertUtcTime,
} from "../../src/services/notifications/alertMessage";
import { formatExternalAlertMessage } from "../../src/server/externalNotifications";
import type { ChannelAlertOperator } from "../../src/types/technicalAlerts";

const triggeredAt = Date.parse("2026-07-18T14:19:57Z");

test("all channels receive one clear Vietnamese selected-timezone alert message", () => {
  const message = {
    symbol: "BTCUSD",
    condition: "crossUp" as const,
    targetPrice: 64_098.59,
    triggerPrice: 64_099.84,
    triggeredAt,
    timeZone: "America/Los_Angeles",
    note: "Xác nhận breakout",
    source: "browser-open" as const,
  };
  const formatted = formatAlertNotificationMessage(message);

  assert.equal(formatted.title, "🚨 BTCUSD — Cảnh báo đã kích hoạt");
  assert.equal(
    formatted.body,
    [
      "🚨 CẢNH BÁO GIAO DỊCH — BTCUSD",
      "Sự kiện: Giá cắt lên mức cảnh báo",
      "Mức cảnh báo: 64,098.59",
      "Giá thị trường khi kích hoạt: 64,099.84",
      "Thời điểm kích hoạt: 2026-07-18 07:19:57 UTC-7",
      "Múi giờ hiển thị: America/Los_Angeles (UTC-7)",
      "Nguồn xử lý: Ứng dụng web đang mở",
      "Ghi chú: Xác nhận breakout",
    ].join("\n"),
  );

  assert.equal(
    formatExternalAlertMessage({ alertId: "alert-1", ...message }),
    formatted.body,
  );
});

test("trendline and channel alerts use specific Vietnamese conditions", () => {
  assert.equal(
    alertConditionLabel("crossDown", {
      version: 1,
      kind: "dynamic-line",
      a: { time: 1, price: 100 },
      b: { time: 2, price: 101 },
      domain: "ray",
      interpolation: "linear",
    }),
    "Giá cắt xuống đường xu hướng",
  );

  const operators: Record<ChannelAlertOperator, string> = {
    "cross-upper-up": "Giá cắt lên biên trên của kênh",
    "cross-upper-down": "Giá cắt xuống biên trên của kênh",
    "cross-lower-up": "Giá cắt lên biên dưới của kênh",
    "cross-lower-down": "Giá cắt xuống biên dưới của kênh",
    enter: "Giá đi vào kênh",
    exit: "Giá đi ra khỏi kênh",
    inside: "Giá đang nằm trong kênh",
    outside: "Giá đang nằm ngoài kênh",
  };
  for (const [operator, expected] of Object.entries(operators)) {
    assert.equal(
      alertConditionLabel("crossUp", {
        version: 1,
        kind: "dynamic-channel",
        boundaryA: {
          version: 1,
          kind: "dynamic-line",
          a: { time: 1, price: 100 },
          b: { time: 2, price: 101 },
          domain: "ray",
          interpolation: "linear",
        },
        boundaryB: {
          version: 1,
          kind: "dynamic-line",
          a: { time: 1, price: 90 },
          b: { time: 2, price: 91 },
          domain: "ray",
          interpolation: "linear",
        },
        operator: operator as ChannelAlertOperator,
      }),
      expected,
    );
  }
});

test("UTC formatting ignores host timezone and normalizes epoch seconds", () => {
  assert.equal(formatAlertUtcTime(triggeredAt), "2026-07-18 14:19:57 UTC");
  assert.equal(
    formatAlertUtcTime(triggeredAt / 1000),
    "2026-07-18 14:19:57 UTC",
  );
  assert.equal(
    formatAlertTime(Date.parse("2026-01-18T14:19:57Z"), "America/Los_Angeles").value,
    "2026-01-18 06:19:57 UTC-8",
  );
  assert.equal(
    formatAlertTime(triggeredAt, "not/a-real-zone").timeZoneLabel,
    "UTC",
  );
});

test("notification text is single-line sanitized and bounded", () => {
  const formatted = formatAlertNotificationMessage({
    symbol: "BTCUSD\n@everyone",
    condition: "crossDown",
    conditionLabel: "Giá cắt xuống\r\nđường xu hướng",
    targetPrice: 100,
    triggerPrice: 99,
    triggeredAt,
    note: `${"á".repeat(500)}\nignored`,
    source: "closed-browser-worker",
  });

  assert.match(formatted.body, /BTCUSD @everyone/);
  assert.match(formatted.body, /Giá cắt xuống đường xu hướng/);
  assert.match(formatted.body, /Nguồn xử lý: Bộ xử lý nền/);
  assert.doesNotMatch(formatted.body, /ignored/);
});
