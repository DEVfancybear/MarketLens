export type EmojiPickerKind = "emoji" | "sticker" | "icon";

export type EmojiCategoryId =
  | "recent"
  | "smileys"
  | "animals"
  | "food"
  | "activities"
  | "travel"
  | "objects"
  | "symbols"
  | "flags";

export interface EmojiCatalogItem {
  readonly kind: EmojiPickerKind;
  readonly value: string;
  readonly label: string;
}

export interface EmojiCatalogSection {
  readonly id: Exclude<EmojiCategoryId, "recent">;
  readonly label: string;
  readonly items: readonly EmojiCatalogItem[];
}

export interface EmojiPickerSelection {
  readonly kind: EmojiPickerKind;
  readonly value: string;
}

export const MAX_EMOJI_RECENTS = 24;
export const DEFAULT_EMOJI_SELECTION: EmojiPickerSelection = {
  kind: "emoji",
  value: "😊",
};

function items(
  kind: EmojiPickerKind,
  values: readonly string[],
): readonly EmojiCatalogItem[] {
  return values.map((value) => ({ kind, value, label: value }));
}

export const EMOJI_CATALOG_SECTIONS: readonly EmojiCatalogSection[] = [
  {
    id: "smileys",
    label: "Smileys & people",
    items: items("emoji", [
      "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "🥲",
      "😊", "😇", "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘",
      "😗", "😙", "😚", "😋", "😛", "😝", "😜", "🤪", "🤨",
      "🧐", "🤓", "😎", "🥸", "🤩", "🥳", "🙂‍↕️", "😏", "😒",
      "😞", "😔", "😟", "😕", "🙁", "☹️", "😣", "😖", "😫",
      "😩", "🥺", "😢", "😭", "😤", "😠", "😡", "🤬", "🤯",
      "😳", "🥵", "🥶", "😱", "😨", "😰", "😥", "😓", "🤗",
      "🤔", "🫣", "🤭", "🫢", "🫡", "🤫", "🫠", "🤥", "😶",
      "😐", "😑", "😬", "🙄", "😯", "😦", "😧", "😮", "😲",
      "🥱", "😴", "🤤", "😪", "😵", "🤐", "🥴", "🤢", "🤮",
      "🤧", "😷", "🤒", "🤕", "🤑", "🤠", "😈", "👿", "👻",
      "💀", "☠️", "👽", "🤖", "💩", "😺", "😸", "😹", "😻",
      "😼", "😽", "🙀", "😿", "😾", "👋", "🤚", "🖐️", "✋",
      "🖖", "🫱", "🫲", "👌", "🤌", "🤏", "✌️", "🤞", "🫰",
      "🤟", "🤘", "🤙", "👈", "👉", "👆", "👇", "☝️", "👍",
      "👎", "✊", "👊", "🤛", "🤜", "👏", "🙌", "🫶", "👐",
      "🤲", "🤝", "🙏", "✍️", "💅", "🤳", "💪", "🦾", "🧠",
      "👀", "👁️", "👄", "🫦", "💋", "👤", "👥", "🫂",
    ]),
  },
  {
    id: "animals",
    label: "Animals & nature",
    items: items("emoji", [
      "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐻‍❄️",
      "🐨", "🐯", "🦁", "🐮", "🐷", "🐽", "🐸", "🐵", "🙈",
      "🙉", "🙊", "🐒", "🐔", "🐧", "🐦", "🐤", "🦆", "🦅",
      "🦉", "🦇", "🐺", "🐗", "🐴", "🦄", "🐝", "🪲", "🐞",
      "🦋", "🐌", "🐛", "🪱", "🐜", "🕷️", "🦂", "🐢", "🐍",
      "🦎", "🐙", "🦑", "🦀", "🦞", "🦐", "🐠", "🐟", "🐡",
      "🦈", "🐬", "🐳", "🐋", "🦭", "🐊", "🐅", "🐆", "🦓",
      "🦬", "🐂", "🐃", "🐄", "🐎", "🐖", "🐏", "🐑", "🦙",
      "🐐", "🦌", "🐘", "🦏", "🦛", "🦒", "🦘", "🦥", "🦦",
      "🦨", "🦡", "🐾", "🐉", "🐲", "🌵", "🎄", "🌲", "🌳",
      "🌴", "🪵", "🌱", "🌿", "☘️", "🍀", "🎍", "🪴", "🌷",
      "🌹", "🌺", "🌸", "🌼", "🌻", "🌞", "🌝", "🌚", "🌙",
      "⭐", "🌟", "✨", "⚡", "🔥", "🌈", "☀️", "☁️", "❄️",
      "☃️", "💨", "💧", "🌊",
    ]),
  },
  {
    id: "food",
    label: "Food & drink",
    items: items("emoji", [
      "🍏", "🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓",
      "🫐", "🍈", "🍒", "🍑", "🥭", "🍍", "🥥", "🥝", "🍅",
      "🍆", "🥑", "🥦", "🥬", "🥒", "🌶️", "🫑", "🌽", "🥕",
      "🫒", "🧄", "🧅", "🥔", "🍠", "🥐", "🥯", "🍞", "🥖",
      "🥨", "🧀", "🥚", "🍳", "🧈", "🥞", "🧇", "🥓", "🥩",
      "🍗", "🍖", "🌭", "🍔", "🍟", "🍕", "🫓", "🥪", "🥙",
      "🧆", "🌮", "🌯", "🫔", "🥗", "🥘", "🫕", "🥫", "🍝",
      "🍜", "🍲", "🍛", "🍣", "🍱", "🥟", "🦪", "🍤", "🍙",
      "🍚", "🍘", "🍥", "🥠", "🥮", "🍢", "🍡", "🍧", "🍨",
      "🍦", "🥧", "🧁", "🍰", "🎂", "🍮", "🍭", "🍬", "🍫",
      "🍿", "🍩", "🍪", "🌰", "🥜", "🍯", "🥛", "☕", "🫖",
      "🍵", "🧃", "🥤", "🧋", "🍺", "🍻", "🥂", "🍷", "🥃",
      "🍸", "🍹", "🧉", "🍾",
    ]),
  },
  {
    id: "activities",
    label: "Activities",
    items: items("emoji", [
      "⚽", "🏀", "🏈", "⚾", "🥎", "🎾", "🏐", "🏉", "🥏",
      "🎱", "🪀", "🏓", "🏸", "🏒", "🏑", "🥍", "🏏", "🪃",
      "🥅", "⛳", "🪁", "🏹", "🎣", "🤿", "🥊", "🥋", "🎽",
      "🛹", "🛼", "🛷", "⛸️", "🥌", "🎿", "⛷️", "🏂", "🏋️",
      "🤼", "🤸", "⛹️", "🤺", "🤾", "🏌️", "🏇", "🧘", "🏄",
      "🏊", "🤽", "🚣", "🧗", "🚵", "🚴", "🏆", "🥇", "🥈",
      "🥉", "🏅", "🎖️", "🏵️", "🎗️", "🎫", "🎟️", "🎪", "🤹",
      "🎭", "🩰", "🎨", "🎬", "🎤", "🎧", "🎼", "🎹", "🥁",
      "🎷", "🎺", "🎸", "🪕", "🎻", "🎲", "♟️", "🎯", "🎳",
      "🎮", "🎰", "🧩",
    ]),
  },
  {
    id: "travel",
    label: "Travel & places",
    items: items("emoji", [
      "🚗", "🚕", "🚙", "🚌", "🚎", "🏎️", "🚓", "🚑", "🚒",
      "🚐", "🛻", "🚚", "🚛", "🚜", "🛵", "🏍️", "🛺", "🚲",
      "🛴", "🚨", "🚔", "🚍", "🚘", "🚖", "🚡", "🚠", "🚟",
      "🚃", "🚋", "🚞", "🚝", "🚄", "🚅", "🚈", "🚂", "🚆",
      "🚇", "🚊", "🚉", "✈️", "🛫", "🛬", "🛩️", "💺", "🛰️",
      "🚀", "🛸", "🚁", "🛶", "⛵", "🚤", "🛥️", "🛳️", "⛴️",
      "🚢", "⚓", "🪝", "⛽", "🚧", "🚦", "🚥", "🗺️", "🗿",
      "🗽", "🗼", "🏰", "🏯", "🏟️", "🎡", "🎢", "🎠", "⛲",
      "⛱️", "🏖️", "🏝️", "🏜️", "🌋", "⛰️", "🏕️", "🏠", "🏢",
      "🏦", "🏨", "🏪", "🏫", "🏛️", "⛪", "🕌", "🕍", "⛩️",
      "🌅", "🌄", "🌠", "🎇", "🎆", "🌇", "🌆", "🌃", "🌌",
      "🌍", "🌎", "🌏", "🪐",
    ]),
  },
  {
    id: "objects",
    label: "Objects",
    items: items("emoji", [
      "⌚", "📱", "📲", "💻", "⌨️", "🖥️", "🖨️", "🖱️", "🕹️",
      "🗜️", "💽", "💾", "💿", "📀", "📼", "📷", "📸", "📹",
      "🎥", "📽️", "🎞️", "📞", "☎️", "📟", "📠", "📺", "📻",
      "🎙️", "🎚️", "🎛️", "🧭", "⏱️", "⏲️", "⏰", "🕰️", "⌛",
      "⏳", "📡", "🔋", "🪫", "🔌", "💡", "🔦", "🕯️", "🧯",
      "🛢️", "💸", "💵", "💴", "💶", "💷", "🪙", "💰", "💳",
      "💎", "⚖️", "🪜", "🧰", "🔧", "🔨", "⚒️", "🛠️", "⛏️",
      "🪓", "🪚", "🔩", "⚙️", "🧱", "⛓️", "🧲", "🔫", "💣",
      "🧨", "🔪", "🛡️", "🚬", "⚰️", "⚱️", "🏺", "🔮",
      "📿", "🧿", "💈", "⚗️", "🔭", "🔬", "🕳️", "🩹", "🩺",
      "💊", "💉", "🧬", "🦠", "🧹", "🧺", "🧻", "🪣", "🧼",
      "🪥", "🛒", "🎁", "🎈", "🎏", "🎀", "🎊", "🎉", "🪄",
      "📌", "📍", "📎", "🖇️", "📏", "📐", "✂️", "🗃️", "🗄️",
      "🗑️", "🔒", "🔓", "🔑", "🗝️", "🔔", "🔕", "📣", "📢",
    ]),
  },
  {
    id: "symbols",
    label: "Symbols",
    items: items("emoji", [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎",
      "💔", "❤️‍🔥", "💕", "💞", "💓", "💗", "💖", "💘", "💝",
      "💟", "☮️", "✝️", "☪️", "🕉️", "☸️", "✡️", "🔯", "🕎",
      "☯️", "☦️", "🛐", "⛎", "♈", "♉", "♊", "♋", "♌",
      "♍", "♎", "♏", "♐", "♑", "♒", "♓", "🆔", "⚛️",
      "☢️", "☣️", "📴", "📳", "🈶", "🈚", "🈸", "🈺", "🈷️",
      "✴️", "🆚", "💮", "🉐", "㊙️", "㊗️", "🈴", "🈵", "🈹",
      "🈲", "🅰️", "🅱️", "🆎", "🆑", "🅾️", "🆘", "❌", "⭕",
      "🛑", "⛔", "📛", "🚫", "💯", "💢", "♨️", "🚷", "🚯",
      "🚳", "🚱", "🔞", "📵", "⚠️", "❗", "❕", "❓", "❔",
      "‼️", "⁉️", "🔅", "🔆", "〽️", "⚜️", "🔱", "✅", "☑️",
      "✔️", "❎", "➕", "➖", "➗", "✖️", "♾️", "™️", "©️",
      "®️", "〰️", "➰", "➿", "🔚", "🔙", "🔛", "🔝", "🔜",
      "⬆️", "↗️", "➡️", "↘️", "⬇️", "↙️", "⬅️", "↖️", "↕️",
      "↔️", "🔄", "↩️", "↪️", "⤴️", "⤵️", "#️⃣", "*️⃣", "0️⃣",
      "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣",
      "🔟", "▶️", "⏸️", "⏯️", "⏹️", "⏺️", "⏭️", "⏮️", "⏩",
      "⏪", "🔀", "🔁", "🔂", "◀️", "🔼", "🔽", "🔘", "🔴",
      "🟠", "🟡", "🟢", "🔵", "🟣", "🟤", "⚫", "⚪", "🟥",
      "🟧", "🟨", "🟩", "🟦", "🟪", "🟫", "⬛", "⬜", "🔶",
      "🔷", "🔸", "🔹", "🔺", "🔻", "💠", "🔳", "🔲",
    ]),
  },
  {
    id: "flags",
    label: "Flags",
    items: items("emoji", [
      "🏁", "🚩", "🎌", "🏴", "🏳️", "🏳️‍🌈", "🏳️‍⚧️", "🏴‍☠️",
      "🇺🇳", "🇺🇸", "🇨🇦", "🇲🇽", "🇧🇷", "🇦🇷", "🇨🇱", "🇨🇴",
      "🇬🇧", "🇮🇪", "🇫🇷", "🇩🇪", "🇮🇹", "🇪🇸", "🇵🇹", "🇳🇱",
      "🇧🇪", "🇨🇭", "🇦🇹", "🇵🇱", "🇺🇦", "🇸🇪", "🇳🇴", "🇩🇰",
      "🇫🇮", "🇮🇸", "🇬🇷", "🇹🇷", "🇷🇴", "🇨🇿", "🇭🇺", "🇪🇺",
      "🇯🇵", "🇰🇷", "🇨🇳", "🇭🇰", "🇹🇼", "🇸🇬", "🇲🇾", "🇹🇭",
      "🇻🇳", "🇮🇩", "🇵🇭", "🇮🇳", "🇵🇰", "🇧🇩", "🇱🇰", "🇳🇵",
      "🇦🇺", "🇳🇿", "🇿🇦", "🇪🇬", "🇳🇬", "🇰🇪", "🇲🇦", "🇸🇦",
      "🇦🇪", "🇶🇦", "🇮🇱",
    ]),
  },
];

export const STICKER_CATALOG: readonly EmojiCatalogItem[] = [
  ["🐂📈", "Bull market"],
  ["🐻📉", "Bear market"],
  ["🚀🌕", "To the moon"],
  ["💎🙌", "Diamond hands"],
  ["🔥🔥", "On fire"],
  ["🎯✅", "Target hit"],
  ["⚡📈", "Momentum up"],
  ["⚡📉", "Momentum down"],
  ["🧲💰", "Money magnet"],
  ["🧠💡", "Trading idea"],
  ["🤖📊", "Algo trading"],
  ["👑🏆", "Winning trade"],
  ["🦄🚀", "Unicorn launch"],
  ["🌊🏄", "Ride the wave"],
  ["💸💸", "Money flying"],
  ["🧨💥", "Breakout"],
  ["🛡️⚔️", "Defend level"],
  ["🔔👀", "Watch alert"],
  ["🧱🧱", "Strong wall"],
  ["🪜📈", "Step higher"],
  ["🪜📉", "Step lower"],
  ["🦈💰", "Market shark"],
  ["🐋📊", "Whale activity"],
  ["🦅🎯", "Eagle eye"],
  ["🍀💰", "Lucky trade"],
  ["🧊🥶", "Frozen market"],
  ["🌋🔥", "Volatility"],
  ["🌪️📊", "Market turbulence"],
  ["☕📈", "Morning setup"],
  ["🌙📉", "Night session"],
  ["☀️📈", "Day session"],
  ["🧭🗺️", "Market direction"],
  ["🔍💎", "Hidden gem"],
  ["🚨📉", "Risk warning"],
  ["🎉💰", "Take profit"],
  ["😭📉", "Stop loss"],
  ["😎✅", "Trade confirmed"],
  ["🤔❓", "Wait and see"],
  ["✋⛔", "Do not trade"],
  ["🙏🍀", "Good luck"],
  ["🏎️💨", "Fast market"],
  ["🐌⏳", "Slow market"],
  ["🎢📊", "Choppy market"],
  ["🧪📈", "Test strategy"],
  ["📌🎯", "Key level"],
  ["💡⚡", "Strong signal"],
  ["❤️‍🔥📈", "Love this setup"],
  ["🏁🏆", "Trade complete"],
].map(([value, label]) => ({ kind: "sticker", value, label }));

const TEXT_PRESENTATION = "\uFE0E";

export const ICON_CATALOG: readonly EmojiCatalogItem[] = [
  ["★", "Filled star"], ["☆", "Star"], ["●", "Filled circle"], ["○", "Circle"],
  ["■", "Filled square"], ["□", "Square"], ["▲", "Triangle up"], ["△", "Triangle up outline"],
  ["▼", "Triangle down"], ["▽", "Triangle down outline"], ["◆", "Diamond"], ["◇", "Diamond outline"],
  ["⬟", "Pentagon"], ["⬢", "Hexagon"], ["✚", "Plus"], ["✖", "Cross"],
  ["✓", "Check"], ["✔", "Heavy check"], ["✕", "Close"], ["!", "Exclamation"],
  ["?", "Question"], ["$", "Dollar"], ["€", "Euro"], ["¥", "Yen"],
  ["₿", "Bitcoin"], ["↑", "Arrow up"], ["↓", "Arrow down"], ["←", "Arrow left"],
  ["→", "Arrow right"], ["↗", "Arrow up right"], ["↘", "Arrow down right"], ["↔", "Horizontal arrows"],
  ["↕", "Vertical arrows"], ["➜", "Arrow"], ["➤", "Arrow head"], ["∞", "Infinity"],
  ["≈", "Approximately"], ["≠", "Not equal"], ["≤", "Less or equal"], ["≥", "Greater or equal"],
  ["+", "Plus"], ["−", "Minus"], ["×", "Multiply"], ["÷", "Divide"],
  ["%", "Percent"], ["#", "Hash"], ["@", "At"], ["&", "Ampersand"],
  ["⚑", "Filled flag"], ["⚐", "Flag"], ["⚡", "Lightning"], ["☀", "Sun"],
  ["☁", "Cloud"], ["☂", "Umbrella"], ["☃", "Snowman"], ["☎", "Phone"],
  ["✉", "Envelope"], ["⚙", "Gear"], ["⌂", "Home"], ["⌁", "Wave"],
  ["⌘", "Command"], ["⌛", "Hourglass"], ["♠", "Spade"], ["♣", "Club"],
  ["♥", "Heart"], ["♦", "Diamond suit"], ["♫", "Music"], ["☯", "Yin yang"],
].map(([value, label]) => ({
  kind: "icon",
  value: `${value}${TEXT_PRESENTATION}`,
  label,
}));

const catalogByKey = new Map<string, EmojiCatalogItem>();
const catalogSelectionByValue = new Map<string, EmojiPickerSelection>();
for (const section of EMOJI_CATALOG_SECTIONS) {
  for (const item of section.items) {
    catalogByKey.set(`${item.kind}:${item.value}`, item);
    catalogSelectionByValue.set(item.value, {
      kind: item.kind,
      value: item.value,
    });
  }
}
for (const item of [...STICKER_CATALOG, ...ICON_CATALOG]) {
  catalogByKey.set(`${item.kind}:${item.value}`, item);
  catalogSelectionByValue.set(item.value, {
    kind: item.kind,
    value: item.value,
  });
}

export function getEmojiCatalogItem(
  selection: EmojiPickerSelection,
): EmojiCatalogItem | undefined {
  return catalogByKey.get(`${selection.kind}:${selection.value}`);
}

export function findEmojiCatalogSelection(
  value: string,
): EmojiPickerSelection | undefined {
  return catalogSelectionByValue.get(value);
}

export function normalizeEmojiRecents(value: unknown): EmojiPickerSelection[] {
  if (!Array.isArray(value)) return [];
  const result: EmojiPickerSelection[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      !("kind" in candidate) ||
      !("value" in candidate)
    ) {
      continue;
    }
    const kind = candidate.kind;
    const itemValue = candidate.value;
    if (
      (kind !== "emoji" && kind !== "sticker" && kind !== "icon") ||
      typeof itemValue !== "string"
    ) {
      continue;
    }
    const selection = { kind, value: itemValue } satisfies EmojiPickerSelection;
    const key = `${kind}:${itemValue}`;
    if (seen.has(key) || !getEmojiCatalogItem(selection)) continue;
    seen.add(key);
    result.push(selection);
    if (result.length >= MAX_EMOJI_RECENTS) break;
  }
  return result;
}

export function pushEmojiRecent(
  recents: readonly EmojiPickerSelection[],
  selection: EmojiPickerSelection,
): EmojiPickerSelection[] {
  return normalizeEmojiRecents([
    selection,
    ...recents.filter(
      (recent) =>
        recent.kind !== selection.kind || recent.value !== selection.value,
    ),
  ]);
}
