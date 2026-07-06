"use client";

import { uid } from "../utils/id";
import type { WatchlistList, WatchlistSection } from "./watchlistStore";

export type SectionInsertMode = "before-section" | "inside-section";

export function normalizeSectionTitle(title: string): string {
  return (title.trim() || "Section").slice(0, 40);
}

export function clampSectionIndex(index: number, symbolCount: number): number {
  if (!Number.isFinite(index)) return symbolCount;
  return Math.max(0, Math.min(symbolCount, Math.round(index)));
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
