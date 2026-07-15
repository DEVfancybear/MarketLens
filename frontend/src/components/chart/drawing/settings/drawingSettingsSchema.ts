import type { Drawing } from "../../../../types/drawing";
import { getDrawingToolManifestEntry, type DrawingSettingsFeature, type DrawingTool } from "../../../../types/drawingToolManifest";

export type DrawingSettingsTab = "inputs" | "style" | "text" | "coordinates" | "visibility";
export type DrawingSettingsSectionId =
  | "line" | "fill" | "text" | "middle-line" | "fib-levels" | "stats"
  | "trendline-parity" | "price-label" | "time-label" | "channel-levels" | "coordinates" | "visibility";

export interface DrawingSettingsFieldDescriptor {
  key: keyof Drawing;
  section: DrawingSettingsSectionId;
  template: boolean;
}

export interface DrawingSettingsSectionDescriptor {
  id: DrawingSettingsSectionId;
  tab: DrawingSettingsTab;
  fields: readonly DrawingSettingsFieldDescriptor[];
}

export interface DrawingSettingsSchema {
  tool: DrawingTool;
  title: string;
  profile: ReturnType<typeof getDrawingToolManifestEntry>["settingsProfile"];
  templateFamily: ReturnType<typeof getDrawingToolManifestEntry>["styleFamily"];
  positionSide?: "long" | "short";
  coordinateLabels?: readonly string[];
  features: readonly DrawingSettingsFeature[];
  tabs: readonly DrawingSettingsTab[];
  sections: readonly DrawingSettingsSectionDescriptor[];
  templateKeys: readonly (keyof Drawing)[];
  hasField: (key: keyof Drawing) => boolean;
  hasFeature: (feature: DrawingSettingsFeature) => boolean;
}

const SECTION_FIELDS: Record<DrawingSettingsSectionId, readonly (keyof Drawing)[]> = {
  line: ["color", "lineWidth", "lineStyle", "extend"],
  fill: ["fillColor", "opacity"],
  text: ["text", "fontSize", "bold", "italic", "textColor", "textBackground", "textBackgroundColor", "textBorder", "textBorderColor", "textWrap", "textHAlign", "textVAlign"],
  "middle-line": ["showMiddleLine", "middleLineColor", "middleLineStyle"],
  "fib-levels": ["fibTrendLine", "fibTrendLineColor", "fibTrendLineWidth", "fibTrendLineStyle", "fibLevelsLine", "fibLevelLineColor", "fibLevelLineWidth", "fibLevelLineStyle", "fibLevels", "fibUseOneColor", "fibBackground", "fibReverse", "fibShowPrices", "fibShowLevels", "fibLevelsFormat", "fibLabelsHAlign", "fibLabelsVAlign", "fibShowText", "fibTextHAlign", "fibTextVAlign", "fibLogScale"],
  stats: ["accountSize", "accountCurrency", "lotSize", "riskValue", "riskUnit", "leverage", "qtyPrecision", "positionStats", "compactStats", "alwaysShowStats", "stop", "target"],
  "trendline-parity": ["lineStart", "lineEnd", "showMidpoint", "showPriceLabels", "showStats"],
  "price-label": ["showPriceLabels"],
  "time-label": ["showTimeLabel"],
  "channel-levels": ["channelLevels", "channelBackground"],
  coordinates: ["points"],
  visibility: ["visible", "intervalVisibility"],
};

const SECTION_TABS: Record<DrawingSettingsSectionId, DrawingSettingsTab> = {
  line: "style", fill: "style", text: "text", "middle-line": "style",
  "fib-levels": "style", stats: "inputs", "trendline-parity": "style",
  "price-label": "style", "time-label": "style", "channel-levels": "style", coordinates: "coordinates", visibility: "visibility",
};

const NON_TEMPLATE_KEYS = new Set<keyof Drawing>([
  "text", "points", "visible", "intervalVisibility", "accountSize", "accountCurrency", "lotSize",
  "riskValue", "riskUnit", "leverage", "qtyPrecision", "positionStats",
  "compactStats", "alwaysShowStats", "stop", "target",
]);

export function getDrawingSettingsSchema(tool: DrawingTool): DrawingSettingsSchema {
  const definition = getDrawingToolManifestEntry(tool);
  const sectionIds = definition.settingsFeatures.filter(
    (feature): feature is DrawingSettingsSectionId => feature !== "templates",
  );
  const sections = sectionIds.map((id) => ({
    id,
    tab: SECTION_TABS[id],
    fields: SECTION_FIELDS[id].map((key) => ({
      key,
      section: id,
      template: !NON_TEMPLATE_KEYS.has(key),
    })),
  }));
  const tabs = (["inputs", "style", "text", "coordinates", "visibility"] as const).filter(
    (tab) => sections.some((section) => section.tab === tab),
  );
  const templateKeys = sections.flatMap((section) =>
    section.fields.filter((field) => field.template).map((field) => field.key),
  );
  const keySet = new Set(sections.flatMap((section) => section.fields.map((field) => field.key)));
  const featureSet = new Set(definition.settingsFeatures);
  return {
    tool,
    title: definition.displayName,
    profile: definition.settingsProfile,
    templateFamily: definition.styleFamily,
    positionSide: definition.positionSide,
    coordinateLabels: definition.coordinateLabels,
    features: definition.settingsFeatures,
    tabs,
    sections,
    templateKeys: [...new Set(templateKeys)],
    hasField: (key) => keySet.has(key),
    hasFeature: (feature) => featureSet.has(feature),
  };
}

export function pickDrawingTemplateStyle(drawing: Drawing): Partial<Drawing> {
  const style: Partial<Drawing> = {};
  for (const key of getDrawingSettingsSchema(drawing.tool).templateKeys) {
    const value = drawing[key];
    if (value !== undefined) (style as Record<string, unknown>)[key] = structuredClone(value);
  }
  return style;
}

export function applyDrawingTemplateStyle(
  tool: DrawingTool,
  template: Partial<Drawing>,
): Partial<Drawing> {
  const patch: Partial<Drawing> = {};
  for (const key of getDrawingSettingsSchema(tool).templateKeys) {
    const value = template[key];
    if (value !== undefined) (patch as Record<string, unknown>)[key] = structuredClone(value);
  }
  return patch;
}
