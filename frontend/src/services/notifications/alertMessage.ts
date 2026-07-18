import type { PushAlertCondition } from "@/types/pushAlerts";
import type {
  ChannelAlertOperator,
  TechnicalAlertTarget,
} from "@/types/technicalAlerts";

/** Every human-readable channel uses this same Vietnamese/timezone contract. */
export interface AlertNotificationMessage {
  symbol: string;
  condition: PushAlertCondition;
  /** Optional Vietnamese label for a dynamic line/channel condition. */
  conditionLabel?: string;
  technicalTarget?: TechnicalAlertTarget;
  targetPrice: number;
  triggerPrice: number;
  triggeredAt: number;
  /** Effective IANA chart time zone. Missing/invalid values fail closed to UTC. */
  timeZone?: string;
  note?: string;
  source?: "browser-open" | "closed-browser-worker" | "test";
}

export const CONDITION_LABEL: Record<PushAlertCondition, string> = {
  above: "Giá chạm hoặc vượt mức cảnh báo",
  below: "Giá chạm hoặc giảm xuống dưới mức cảnh báo",
  crossUp: "Giá cắt lên mức cảnh báo",
  crossDown: "Giá cắt xuống mức cảnh báo",
};

const TRENDLINE_LABEL: Partial<Record<PushAlertCondition, string>> = {
  above: "Giá chạm hoặc vượt đường xu hướng",
  below: "Giá chạm hoặc giảm xuống dưới đường xu hướng",
  crossUp: "Giá cắt lên đường xu hướng",
  crossDown: "Giá cắt xuống đường xu hướng",
};

const CHANNEL_OPERATOR_LABEL: Record<ChannelAlertOperator, string> = {
  "cross-upper-up": "Giá cắt lên biên trên của kênh",
  "cross-upper-down": "Giá cắt xuống biên trên của kênh",
  "cross-lower-up": "Giá cắt lên biên dưới của kênh",
  "cross-lower-down": "Giá cắt xuống biên dưới của kênh",
  enter: "Giá đi vào kênh",
  exit: "Giá đi ra khỏi kênh",
  inside: "Giá đang nằm trong kênh",
  outside: "Giá đang nằm ngoài kênh",
};

const SOURCE_LABEL = {
  "browser-open": "Ứng dụng web đang mở",
  "closed-browser-worker": "Bộ xử lý nền",
  test: "Kiểm tra tích hợp",
} as const;

export function alertConditionLabel(
  condition: PushAlertCondition,
  technicalTarget?: TechnicalAlertTarget,
): string {
  if (technicalTarget?.kind === "dynamic-channel") {
    return (
      CHANNEL_OPERATOR_LABEL[technicalTarget.operator] ??
      CONDITION_LABEL[condition] ??
      "Điều kiện cảnh báo"
    );
  }
  if (technicalTarget?.kind === "dynamic-line") {
    return TRENDLINE_LABEL[condition] ?? CONDITION_LABEL[condition];
  }
  return CONDITION_LABEL[condition] ?? "Điều kiện cảnh báo";
}

function cleanNotificationText(value: string | undefined, limit: number): string {
  const normalized = (value ?? "").trim().replace(/[\r\n]+/g, " ");
  return Array.from(normalized).slice(0, limit).join("");
}

export function formatAlertPrice(value: number): string {
  if (!Number.isFinite(value)) return "Không xác định";
  return new Intl.NumberFormat("en-US", {
    useGrouping: true,
    maximumFractionDigits: 8,
  }).format(value);
}

export function normalizeAlertTimeZone(value: unknown): string {
  if (typeof value !== "string") return "UTC";
  const normalized = value.trim();
  if (!normalized || normalized === "exchange" || normalized.length > 80) {
    return "UTC";
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format(0);
    return normalized;
  } catch {
    return "UTC";
  }
}

type AlertTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function alertTimeParts(date: Date, timeZone: string): AlertTimeParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function utcOffsetLabel(date: Date, timeZone: string, parts: AlertTimeParts): string {
  const zonedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const epochWithoutMilliseconds = date.getTime() - date.getUTCMilliseconds();
  const offsetMinutes = Math.round(
    (zonedAsUtc - epochWithoutMilliseconds) / 60_000,
  );
  if (offsetMinutes === 0) return "UTC";
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  return minutes === 0
    ? `UTC${sign}${hours}`
    : `UTC${sign}${hours}:${String(minutes).padStart(2, "0")}`;
}

export function formatAlertTime(
  timestamp: number,
  requestedTimeZone?: string,
): { value: string; timeZoneLabel: string; timeZone: string } {
  const timeZone = normalizeAlertTimeZone(requestedTimeZone);
  const normalizedTimestamp =
    Math.abs(timestamp) < 100_000_000_000 ? timestamp * 1000 : timestamp;
  const date = new Date(normalizedTimestamp);
  const fallbackLabel = timeZone === "UTC" ? "UTC" : timeZone;
  if (!Number.isFinite(timestamp) || timestamp <= 0 || !Number.isFinite(date.getTime())) {
    return {
      value: "Không xác định",
      timeZoneLabel: fallbackLabel,
      timeZone,
    };
  }
  const parts = alertTimeParts(date, timeZone);
  const offset = utcOffsetLabel(date, timeZone, parts);
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    value: `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)} ${offset}`,
    timeZoneLabel: timeZone === "UTC" ? "UTC" : `${timeZone} (${offset})`,
    timeZone,
  };
}

/** Backwards-compatible explicit UTC helper used by existing callers/tests. */
export function formatAlertUtcTime(timestamp: number): string {
  return formatAlertTime(timestamp, "UTC").value;
}

export function alertSourceLabel(
  source: AlertNotificationMessage["source"],
): string {
  return source && source in SOURCE_LABEL
    ? SOURCE_LABEL[source as keyof typeof SOURCE_LABEL]
    : "Hệ thống cảnh báo";
}

export function formatAlertNotificationMessage(
  message: AlertNotificationMessage,
): { title: string; body: string } {
  const condition =
    cleanNotificationText(message.conditionLabel, 160) ||
    alertConditionLabel(message.condition, message.technicalTarget);
  const symbol = cleanNotificationText(message.symbol, 40) || "Không xác định";
  const alertTime = formatAlertTime(message.triggeredAt, message.timeZone);
  const lines = [
    `🚨 CẢNH BÁO GIAO DỊCH — ${symbol}`,
    `Sự kiện: ${condition}`,
    `Mức cảnh báo: ${formatAlertPrice(message.targetPrice)}`,
    `Giá thị trường khi kích hoạt: ${formatAlertPrice(message.triggerPrice)}`,
    `Thời điểm kích hoạt: ${alertTime.value}`,
    `Múi giờ hiển thị: ${alertTime.timeZoneLabel}`,
    `Nguồn xử lý: ${alertSourceLabel(message.source)}`,
  ];
  const note = cleanNotificationText(message.note, 500);
  if (note) lines.push(`Ghi chú: ${note}`);
  return {
    title: `🚨 ${symbol} — Cảnh báo đã kích hoạt`,
    body: lines.join("\n"),
  };
}
