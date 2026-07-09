export const DEFAULT_PANELS = { right: 320, bottom: 240, left: 52 } as const;

export const DEFAULT_UI_SETTINGS = {
  theme: "dark",
  panels: DEFAULT_PANELS,
  bottomTab: "replay",
  rightOpen: true,
  bottomOpen: false,
  fullscreen: false,
  alertCenterOpen: false,
  gridVisible: true,
} as const;

export const DEFAULT_SMC_SETTINGS = {
  structure: false,
  fvg: false,
  orderBlocks: false,
  liquidity: false,
  displacement: false,
  sessions: false,
  killzones: false,
  swings: false,
} as const;
