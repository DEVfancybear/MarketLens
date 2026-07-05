export type IndicatorCatalogCategory =
  | "technicals"
  | "fundamentals"
  | "editors"
  | "top"
  | "trending";

export type IndicatorCatalogType =
  | "indicator"
  | "strategy"
  | "profile"
  | "pattern"
  | "fundamental";

export type IndicatorCatalogSource = "tradingview" | "pending";

export interface IndicatorCatalogItem {
  id: string;
  name: string;
  author: string;
  boosts: string;
  category: IndicatorCatalogCategory;
  type: IndicatorCatalogType;
  url?: string;
}

export interface IndicatorCatalogResponse {
  items: IndicatorCatalogItem[];
  source: IndicatorCatalogSource;
  fetchedAt: number;
  error?: string;
}

export const TRADINGVIEW_SCRIPT_CATEGORY_URLS: Record<
  IndicatorCatalogCategory,
  string | null
> = {
  technicals: "https://www.tradingview.com/scripts/technical-indicators/",
  fundamentals: "https://www.tradingview.com/scripts/fundamental-analysis/",
  editors: "https://www.tradingview.com/scripts/editors-picks/",
  top: "https://www.tradingview.com/scripts/top/",
  // TradingView's public scripts landing page is the most stable public source
  // for currently promoted/trending community scripts. The in-chart modal uses
  // private endpoints that are not documented for third-party clients.
  trending: "https://www.tradingview.com/scripts/",
};

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function compactBoosts(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(Math.round(value));
}

function inferCatalogType(name: string): IndicatorCatalogType {
  const lower = name.toLowerCase();
  if (lower.includes("strategy")) return "strategy";
  if (lower.includes("profile") || lower.includes("volume profile")) {
    return "profile";
  }
  if (lower.includes("pattern")) return "pattern";
  return "indicator";
}

function itemIdFromUrl(url: string, fallbackName: string): string {
  const match = /\/script\/([^/]+)\//.exec(url);
  return match?.[1] ?? slugId(fallbackName);
}

export function parseTradingViewScriptsHtml(
  html: string,
  category: IndicatorCatalogCategory,
  limit = 40,
): IndicatorCatalogItem[] {
  const articles = html.match(/<article\b[\s\S]*?<\/article>/g) ?? [];
  const items: IndicatorCatalogItem[] = [];

  for (const article of articles) {
    const titleMatch =
      /<a[^>]+href="([^"]+)"[^>]+data-qa-id="ui-lib-card-link-title"[^>]*>([\s\S]*?)<\/a>/.exec(
        article,
      );
    if (!titleMatch) continue;

    const url = titleMatch[1].startsWith("http")
      ? titleMatch[1]
      : `https://www.tradingview.com${titleMatch[1]}`;
    const name = decodeHtml(titleMatch[2].replace(/<[^>]+>/g, ""));
    if (!name) continue;

    const authorMatch =
      /data-qa-id="ui-lib-card-link-author"[\s\S]*?<span[^>]*>\s*by\s+([\s\S]*?)<\/span>/.exec(
        article,
      );
    const author = authorMatch
      ? decodeHtml(authorMatch[1].replace(/<[^>]+>/g, ""))
      : "TradingView";

    const boostsMatch = /aria-label="([\d,.]+)\s+boosts?"/i.exec(article);
    const boosts = boostsMatch
      ? compactBoosts(Number(boostsMatch[1].replace(/,/g, "")))
      : "0";

    items.push({
      id: itemIdFromUrl(url, name),
      name,
      author,
      boosts,
      category,
      type: inferCatalogType(name),
      url,
    });
    if (items.length >= limit) break;
  }

  return items;
}

export function filterCatalogItems(
  items: IndicatorCatalogItem[],
  query: string,
  type: "all" | IndicatorCatalogType,
): IndicatorCatalogItem[] {
  const q = query.trim().toLowerCase();
  return items.filter((item) => {
    if (type !== "all" && item.type !== type) return false;
    if (!q) return true;
    return [item.name, item.author].some((value) =>
      value.toLowerCase().includes(q),
    );
  });
}
