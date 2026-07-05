import { NextResponse, type NextRequest } from "next/server";
import {
  parseTradingViewScriptsHtml,
  TRADINGVIEW_SCRIPT_CATEGORY_URLS,
  type IndicatorCatalogCategory,
  type IndicatorCatalogResponse,
} from "@/services/tradingViewIndicatorCatalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CATEGORIES = new Set<IndicatorCatalogCategory>([
  "technicals",
  "fundamentals",
  "editors",
  "top",
  "trending",
]);

function parseCategory(value: string | null): IndicatorCatalogCategory {
  return CATEGORIES.has(value as IndicatorCatalogCategory)
    ? (value as IndicatorCatalogCategory)
    : "trending";
}

export async function GET(req: NextRequest) {
  const category = parseCategory(req.nextUrl.searchParams.get("category"));
  const url = TRADINGVIEW_SCRIPT_CATEGORY_URLS[category];

  if (!url) {
    const response: IndicatorCatalogResponse = {
      items: [],
      source: "pending",
      fetchedAt: Date.now(),
      error: "No public TradingView source is configured for this category.",
    };
    return NextResponse.json(response);
  }

  try {
    const upstream = await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      },
      cache: "no-store",
    });

    if (!upstream.ok) throw new Error(`TradingView ${upstream.status}`);

    const html = await upstream.text();
    const parsed = parseTradingViewScriptsHtml(html, category, 40);
    const response: IndicatorCatalogResponse = {
      items: parsed,
      source: parsed.length > 0 ? "tradingview" : "pending",
      fetchedAt: Date.now(),
      error:
        parsed.length > 0
          ? undefined
          : "TradingView returned no parseable indicator rows.",
    };
    return NextResponse.json(response);
  } catch (error) {
    const response: IndicatorCatalogResponse = {
      items: [],
      source: "pending",
      fetchedAt: Date.now(),
      error:
        error instanceof Error
          ? error.message
          : "TradingView indicator request failed.",
    };
    return NextResponse.json(response);
  }
}
