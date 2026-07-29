"use client";

import {
  Cat,
  Clock3,
  Flag,
  Gamepad2,
  Heart,
  Lightbulb,
  Plane,
  Smile,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import { useRef, useState, type UIEvent } from "react";
import { cn } from "@/utils/cn";
import {
  EMOJI_CATALOG_SECTIONS,
  getEmojiCatalogItem,
  ICON_CATALOG,
  STICKER_CATALOG,
  type EmojiCatalogItem,
  type EmojiCategoryId,
  type EmojiPickerKind,
  type EmojiPickerSelection,
} from "@/types/emojiCatalog";
import type { AppLanguage } from "@/i18n/localization";

interface EmojiPickerPopoverProps {
  language: AppLanguage;
  selection: EmojiPickerSelection;
  recents: readonly EmojiPickerSelection[];
  onSelect: (selection: EmojiPickerSelection) => void;
}

const CATEGORY_NAV: readonly {
  id: EmojiCategoryId;
  icon: LucideIcon;
}[] = [
  { id: "recent", icon: Clock3 },
  { id: "smileys", icon: Smile },
  { id: "animals", icon: Cat },
  { id: "food", icon: UtensilsCrossed },
  { id: "activities", icon: Gamepad2 },
  { id: "travel", icon: Plane },
  { id: "objects", icon: Lightbulb },
  { id: "symbols", icon: Heart },
  { id: "flags", icon: Flag },
];

const COPY = {
  en: {
    recent: "Recently used",
    smileys: "Smileys & people",
    animals: "Animals & nature",
    food: "Food & drink",
    activities: "Activities",
    travel: "Travel & places",
    objects: "Objects",
    symbols: "Symbols",
    flags: "Flags",
    emoji: "Emojis",
    sticker: "Stickers",
    icon: "Icons",
    empty: "Your recently used items will appear here.",
  },
  vi: {
    recent: "Dùng gần đây",
    smileys: "Mặt cười & con người",
    animals: "Động vật & thiên nhiên",
    food: "Đồ ăn & thức uống",
    activities: "Hoạt động",
    travel: "Du lịch & địa điểm",
    objects: "Đồ vật",
    symbols: "Biểu tượng",
    flags: "Cờ",
    emoji: "Emoji",
    sticker: "Nhãn dán",
    icon: "Biểu tượng",
    empty: "Những mục bạn dùng gần đây sẽ xuất hiện tại đây.",
  },
} satisfies Record<AppLanguage, Record<string, string>>;

const TABS: readonly EmojiPickerKind[] = ["emoji", "sticker", "icon"];

function selectionKey(selection: EmojiPickerSelection): string {
  return `${selection.kind}:${selection.value}`;
}

export function EmojiPickerPopover({
  language,
  selection,
  recents,
  onSelect,
}: EmojiPickerPopoverProps) {
  const copy = COPY[language];
  const [activeTab, setActiveTab] = useState<EmojiPickerKind>(selection.kind);
  const [activeCategory, setActiveCategory] =
    useState<EmojiCategoryId>("recent");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<
    Partial<Record<EmojiCategoryId, HTMLElement | null>>
  >({});
  const selectedKey = selectionKey(selection);
  const recentItems = recents
    .filter((recent) => recent.kind === activeTab)
    .map(getEmojiCatalogItem)
    .filter((item): item is EmojiCatalogItem => item !== undefined);

  const chooseCategory = (id: EmojiCategoryId) => {
    setActiveCategory(id);
    const scroller = scrollRef.current;
    const section = sectionRefs.current[id];
    if (!scroller || !section) return;
    scroller.scrollTo({
      top: Math.max(0, section.offsetTop - 8),
      behavior: "smooth",
    });
  };

  const updateActiveCategory = (event: UIEvent<HTMLDivElement>) => {
    if (activeTab !== "emoji") return;
    const threshold = event.currentTarget.scrollTop + 36;
    let next: EmojiCategoryId = "recent";
    for (const { id } of CATEGORY_NAV) {
      const section = sectionRefs.current[id];
      if (section && section.offsetTop <= threshold) next = id;
    }
    if (next !== activeCategory) setActiveCategory(next);
  };

  const selectTab = (kind: EmojiPickerKind) => {
    setActiveTab(kind);
    setActiveCategory("recent");
    scrollRef.current?.scrollTo({ top: 0 });
  };

  const itemButton = (
    item: EmojiCatalogItem,
    mode: "emoji" | "sticker" | "icon",
  ) => {
    const itemSelection = { kind: item.kind, value: item.value };
    const selected = selectionKey(itemSelection) === selectedKey;
    return (
      <button
        key={`${item.kind}:${item.value}`}
        type="button"
        title={item.label}
        aria-label={item.label}
        aria-pressed={selected}
        onClick={() => onSelect(itemSelection)}
        className={cn(
          "group flex items-center justify-center rounded-md outline-none transition-colors motion-reduce:transition-none",
          "focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:ring-offset-terminal-raised",
          mode === "emoji" && "h-9 w-9 text-[25px] hover:bg-terminal-hover",
          mode === "sticker" &&
            "h-12 min-w-0 bg-terminal-panel-2 text-[21px] shadow-sm hover:bg-terminal-hover",
          mode === "icon" &&
            "h-9 w-9 font-sans text-[23px] text-ink hover:bg-terminal-hover",
          selected && "bg-brand/15 ring-1 ring-brand/70",
        )}
      >
        <span
          className={cn(
            "select-none leading-none",
            mode === "sticker" &&
              "transition-transform group-hover:scale-110 motion-reduce:transform-none",
          )}
        >
          {item.value}
        </span>
      </button>
    );
  };

  return (
    <div
      data-emoji-picker
      className="flex h-full min-h-0 flex-col overflow-hidden bg-terminal-raised"
    >
      {activeTab === "emoji" && (
        <div
          aria-label={copy.emoji}
          className="grid shrink-0 grid-cols-9 border-b border-terminal-border bg-terminal-panel-2 px-2"
        >
          {CATEGORY_NAV.map(({ id, icon: CategoryIcon }) => (
            <button
              key={id}
              type="button"
              title={copy[id]}
              aria-label={copy[id]}
              aria-pressed={activeCategory === id}
              onClick={() => chooseCategory(id)}
              className={cn(
                "relative flex h-11 items-center justify-center text-ink-muted outline-none transition-colors",
                "hover:text-ink focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand",
                activeCategory === id && "text-ink",
              )}
            >
              <CategoryIcon size={19} strokeWidth={1.7} />
              {activeCategory === id && (
                <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-brand" />
              )}
            </button>
          ))}
        </div>
      )}

      <div
        ref={scrollRef}
        id={`emoji-picker-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`emoji-picker-tab-${activeTab}`}
        onScroll={updateActiveCategory}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2.5"
      >
        {activeTab === "emoji" && (
          <>
            <section
              ref={(node) => {
                sectionRefs.current.recent = node;
              }}
              className="pb-3"
            >
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                {copy.recent}
              </h3>
              {recentItems.length > 0 ? (
                <div className="grid grid-cols-9 gap-y-1">
                  {recentItems.map((item) => itemButton(item, "emoji"))}
                </div>
              ) : (
                <p className="rounded-lg bg-terminal-panel-2 px-3 py-4 text-center text-[11px] text-ink-faint">
                  {copy.empty}
                </p>
              )}
            </section>
            {EMOJI_CATALOG_SECTIONS.map((section) => (
              <section
                key={section.id}
                ref={(node) => {
                  sectionRefs.current[section.id] = node;
                }}
                className="pb-3"
              >
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                  {copy[section.id]}
                </h3>
                <div className="grid grid-cols-9 gap-y-1">
                  {section.items.map((item) => itemButton(item, "emoji"))}
                </div>
              </section>
            ))}
          </>
        )}

        {activeTab === "sticker" && (
          <section
            ref={(node) => {
              sectionRefs.current.recent = node;
            }}
          >
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
              {copy.sticker}
            </h3>
            {recentItems.length > 0 && (
              <>
                <p className="mb-2 text-[10px] font-medium text-ink-faint">
                  {copy.recent}
                </p>
                <div className="mb-4 grid grid-cols-6 gap-1.5">
                  {recentItems.map((item) => itemButton(item, "sticker"))}
                </div>
              </>
            )}
            <div className="grid grid-cols-6 gap-1.5">
              {STICKER_CATALOG.map((item) => itemButton(item, "sticker"))}
            </div>
          </section>
        )}

        {activeTab === "icon" && (
          <section
            ref={(node) => {
              sectionRefs.current.recent = node;
            }}
          >
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
              {copy.icon}
            </h3>
            {recentItems.length > 0 && (
              <>
                <p className="mb-2 text-[10px] font-medium text-ink-faint">
                  {copy.recent}
                </p>
                <div className="mb-4 grid grid-cols-8 gap-y-1">
                  {recentItems.map((item) => itemButton(item, "icon"))}
                </div>
              </>
            )}
            <div className="grid grid-cols-8 gap-y-1">
              {ICON_CATALOG.map((item) => itemButton(item, "icon"))}
            </div>
          </section>
        )}
      </div>

      <div
        role="tablist"
        aria-label={language === "vi" ? "Loại biểu tượng" : "Icon type"}
        className="grid shrink-0 grid-cols-3 border-t border-terminal-border bg-terminal-panel-2"
      >
        {TABS.map((kind) => (
          <button
            key={kind}
            id={`emoji-picker-tab-${kind}`}
            type="button"
            role="tab"
            aria-selected={activeTab === kind}
            aria-controls={`emoji-picker-panel-${kind}`}
            tabIndex={activeTab === kind ? 0 : -1}
            onClick={() => selectTab(kind)}
            className={cn(
              "h-10 text-xs font-semibold outline-none transition-colors",
              "hover:bg-terminal-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand",
              activeTab === kind ? "text-brand" : "text-ink-muted",
            )}
          >
            {copy[kind]}
          </button>
        ))}
      </div>
    </div>
  );
}
