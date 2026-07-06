"use client";

import { uid } from "../utils/id";
import type { WatchlistList, WatchlistSection } from "./watchlistStore";

export type SectionInsertMode = "before-section" | "inside-section";

type WatchlistLayoutToken =
  | { kind: "section"; section: WatchlistSection }
  | { kind: "symbol"; ticker: string };

export function normalizeSectionTitle(title: string): string {
  return (title.trim() || "Section").slice(0, 40);
}

export function clampSectionIndex(index: number, symbolCount: number): number {
  if (!Number.isFinite(index)) return symbolCount;
  return Math.max(0, Math.min(symbolCount, Math.round(index)));
}

export function resolveSectionDropMode(
  pointerY: number,
  rowTop: number,
  rowHeight: number,
): SectionInsertMode {
  if (!Number.isFinite(rowHeight) || rowHeight <= 0) return "inside-section";
  const ratio = (pointerY - rowTop) / rowHeight;
  return ratio <= 0.2 ? "before-section" : "inside-section";
}

export function createWatchlistSection(
  title: string,
  index: number,
  symbolCount: number,
): WatchlistSection {
  return {
    id: uid("wl_section"),
    title: normalizeSectionTitle(title),
    index: clampSectionIndex(index, symbolCount),
  };
}

export function renameSectionInList(
  list: WatchlistList,
  sectionId: string,
  title: string,
): WatchlistList {
  const nextTitle = normalizeSectionTitle(title);
  return {
    ...list,
    sections: list.sections.map((section) =>
      section.id === sectionId ? { ...section, title: nextTitle } : section,
    ),
  };
}

export function removeSectionFromList(
  list: WatchlistList,
  sectionId: string,
): WatchlistList {
  return {
    ...list,
    sections: list.sections.filter((section) => section.id !== sectionId),
  };
}

export function removeSymbolFromList(
  list: WatchlistList,
  ticker: string,
): WatchlistList {
  const index = list.symbols.indexOf(ticker);
  if (index < 0) return list;
  const symbols = list.symbols.filter((symbol) => symbol !== ticker);
  return {
    ...list,
    symbols,
    sections: list.sections
      .map((section) => ({
        ...section,
        index:
          section.index > index
            ? clampSectionIndex(section.index - 1, symbols.length)
            : clampSectionIndex(section.index, symbols.length),
      }))
      .filter((section) => section.index <= symbols.length),
  };
}

function toLayoutTokens(list: WatchlistList): WatchlistLayoutToken[] {
  const order = new Map(list.sections.map((section, index) => [section.id, index]));
  const sections = [...list.sections].sort((a, b) => {
    const byIndex = a.index - b.index;
    if (byIndex !== 0) return byIndex;
    return (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
  });
  const tokens: WatchlistLayoutToken[] = [];
  let sectionIndex = 0;

  for (let index = 0; index <= list.symbols.length; index += 1) {
    while (
      sections[sectionIndex] &&
      sections[sectionIndex].index === index
    ) {
      tokens.push({ kind: "section", section: sections[sectionIndex] });
      sectionIndex += 1;
    }
    if (index < list.symbols.length) {
      tokens.push({ kind: "symbol", ticker: list.symbols[index] });
    }
  }

  while (sections[sectionIndex]) {
    tokens.push({ kind: "section", section: sections[sectionIndex] });
    sectionIndex += 1;
  }

  return tokens;
}

function fromLayoutTokens(
  list: WatchlistList,
  tokens: WatchlistLayoutToken[],
): WatchlistList {
  const symbols: string[] = [];
  const sections: WatchlistSection[] = [];

  for (const token of tokens) {
    if (token.kind === "symbol") {
      symbols.push(token.ticker);
    } else {
      sections.push({
        ...token.section,
        index: clampSectionIndex(symbols.length, list.symbols.length),
      });
    }
  }

  return { ...list, symbols, sections };
}

export function moveSymbolToSectionInList(
  list: WatchlistList,
  ticker: string,
  sectionId: string,
  mode: SectionInsertMode = "inside-section",
): WatchlistList {
  if (!list.symbols.includes(ticker)) return list;

  const tokensWithoutSymbol = toLayoutTokens(list).filter(
    (token) => token.kind !== "symbol" || token.ticker !== ticker,
  );
  const sectionTokenIndex = tokensWithoutSymbol.findIndex(
    (token) => token.kind === "section" && token.section.id === sectionId,
  );
  if (sectionTokenIndex < 0) return list;

  const insertIndex =
    mode === "before-section" ? sectionTokenIndex : sectionTokenIndex + 1;
  const tokens = [
    ...tokensWithoutSymbol.slice(0, insertIndex),
    { kind: "symbol" as const, ticker },
    ...tokensWithoutSymbol.slice(insertIndex),
  ];

  return fromLayoutTokens(list, tokens);
}

export function moveSymbolInList(
  list: WatchlistList,
  ticker: string,
  requestedIndex: number,
  mode: SectionInsertMode = "inside-section",
): WatchlistList {
  const fromIndex = list.symbols.indexOf(ticker);
  if (fromIndex < 0) return list;

  const without = list.symbols.filter((symbol) => symbol !== ticker);
  const rawIndex = clampSectionIndex(requestedIndex, list.symbols.length);
  const toIndex = clampSectionIndex(
    fromIndex < rawIndex ? rawIndex - 1 : rawIndex,
    without.length,
  );
  if (fromIndex === toIndex && rawIndex === fromIndex) {
    return list;
  }

  const symbols = [
    ...without.slice(0, toIndex),
    ticker,
    ...without.slice(toIndex),
  ];

  const sections = list.sections.map((section) => {
    let index = section.index;

    if (index > fromIndex) index -= 1;

    // Dropping "inside" a section keeps a section header before the inserted
    // symbol when the symbol is inserted at the header's index. Dropping before
    // a section shifts the header right so the symbol is placed outside it.
    if (mode === "before-section") {
      if (index >= toIndex) index += 1;
    } else if (index > toIndex) {
      index += 1;
    }

    return {
      ...section,
      index: clampSectionIndex(index, symbols.length),
    };
  });

  return { ...list, symbols, sections };
}
