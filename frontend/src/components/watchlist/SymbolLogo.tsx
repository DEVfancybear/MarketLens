"use client";
import { useState } from "react";
import { BarChart3, Bitcoin, Building2, Coins, Globe2, Package } from "lucide-react";
import { getMarketSymbol } from "@/services/market-data/symbols";
import type { AssetClass, MarketSymbol } from "@/types";

/**
 * TradingView-style circular symbol logo. Forex pairs render two overlapping
 * country flags (base currency in front, quote behind); metals render the
 * metal icon over the quote-currency flag; crypto and indices render a single
 * logo. Assets come from TradingView's public logo CDN
 * (s3-symbol-logo.tradingview.com) with a lettered-circle fallback whenever a
 * logo fails to load (offline, unknown symbol, CDN change).
 */
const CDN = "https://s3-symbol-logo.tradingview.com";

const CURRENCY_FLAG: Record<string, string> = {
  USD: "US",
  EUR: "EU",
  GBP: "GB",
  JPY: "JP",
  AUD: "AU",
  NZD: "NZ",
  CAD: "CA",
  CHF: "CH",
  CNY: "CN",
  SGD: "SG",
  HKD: "HK",
  SEK: "SE",
  NOK: "NO",
  MXN: "MX",
  ZAR: "ZA",
  TRY: "TR",
  PLN: "PL",
};

const METAL_ICON: Record<string, string> = {
  XAU: "metal/gold",
  XAG: "metal/silver",
  XPT: "metal/platinum",
  XPD: "metal/palladium",
};

const INDEX_ICON: Record<string, string> = {
  SPX500: "indices/s-and-p-500",
  NAS100: "indices/nasdaq-100",
};

function flagUrl(ccy?: string): string | undefined {
  const cc = ccy ? CURRENCY_FLAG[ccy] : undefined;
  return cc ? `${CDN}/country/${cc}.svg` : undefined;
}

function logoUrls(meta: MarketSymbol | undefined): string[] {
  if (!meta) return [];
  switch (meta.assetClass) {
    case "crypto":
      return meta.base ? [`${CDN}/crypto/XTVC${meta.base}.svg`] : [];
    case "forex":
      return [flagUrl(meta.base), flagUrl(meta.quote)].filter(
        (u): u is string => !!u,
      );
    case "metal":
      return [
        meta.base && METAL_ICON[meta.base]
          ? `${CDN}/${METAL_ICON[meta.base]}.svg`
          : undefined,
        flagUrl(meta.quote),
      ].filter((u): u is string => !!u);
    case "index":
      return INDEX_ICON[meta.id] ? [`${CDN}/${INDEX_ICON[meta.id]}.svg`] : [];
    default:
      return [];
  }
}

function FallbackCircle({
  letter,
  size,
  assetClass,
  className,
  style,
}: {
  letter: string;
  size: number;
  assetClass?: AssetClass;
  className?: string;
  style?: React.CSSProperties;
}) {
  const Icon = assetClass ? {
    crypto: Bitcoin,
    forex: Globe2,
    index: BarChart3,
    metal: Coins,
    stock: Building2,
    commodity: Package,
  }[assetClass] : null;
  return (
    <span
      className={`flex items-center justify-center rounded-full bg-terminal-panel-2 font-bold text-ink-muted ${className ?? ""}`}
      style={{ width: size, height: size, fontSize: size * 0.5, ...style }}
    >
      {Icon ? <Icon size={Math.max(12, Math.round(size * 0.52))} strokeWidth={2.2} aria-hidden="true" /> : letter}
    </span>
  );
}

function LogoImg({
  src,
  alt,
  size,
  fallback,
  assetClass,
  className,
  style,
}: {
  src: string;
  alt: string;
  size: number;
  fallback: string;
  assetClass?: AssetClass;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [err, setErr] = useState(false);
  if (err) {
    return (
      <FallbackCircle
        letter={fallback}
        size={size}
        assetClass={assetClass}
        className={className}
        style={style}
      />
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      draggable={false}
      onError={() => setErr(true)}
      className={`rounded-full ${className ?? ""}`}
      style={style}
    />
  );
}

/**
 * Fixed-width logo slot (1.5×size) so symbol names align across rows whether
 * the symbol has one logo or an overlapping pair, exactly like TradingView.
 */
export function SymbolLogo({ id, size = 18 }: { id: string; size?: number }) {
  const meta = getMarketSymbol(id);
  const urls = logoUrls(meta);
  const slot = Math.round(size * 1.5);

  return (
    <span
      className="relative block shrink-0"
      style={{ width: slot, height: size }}
    >
      {urls.length === 0 && (
        <FallbackCircle
          letter={id[0] ?? "?"}
          size={size}
          assetClass={meta?.assetClass}
        />
      )}
      {urls.length === 1 && (
        <LogoImg
          src={urls[0]}
          alt={id}
          size={size}
          fallback={id[0] ?? "?"}
          assetClass={meta?.assetClass}
        />
      )}
      {urls.length === 2 && (
        <>
          <LogoImg
            src={urls[1]}
            alt={meta?.quote ?? id}
            size={size}
            fallback={meta?.quote?.[0] ?? "?"}
            assetClass={meta?.assetClass}
            className="absolute right-0 top-0"
            style={{ position: "absolute", right: 0, top: 0 }}
          />
          <LogoImg
            src={urls[0]}
            alt={meta?.base ?? id}
            size={size}
            fallback={meta?.base?.[0] ?? "?"}
            assetClass={meta?.assetClass}
            className="absolute left-0 top-0 z-[1]"
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              boxShadow: "0 0 0 2px var(--panel)",
            }}
          />
        </>
      )}
    </span>
  );
}
