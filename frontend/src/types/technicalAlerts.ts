/** Immutable, versioned geometry evaluated by both open- and closed-browser alerts. */
export interface TechnicalAlertPoint {
  /** UTC epoch seconds, matching drawing anchors. */
  time: number;
  price: number;
}

/** Market observations that prove why a technical alert fired. */
export interface TechnicalAlertEvidencePoint {
  price: number;
  /** UTC epoch seconds. */
  timestamp: number;
}

export interface TechnicalAlertEvidence {
  previous?: TechnicalAlertEvidencePoint;
  current: TechnicalAlertEvidencePoint;
}

export type DynamicLineDomain = "segment" | "ray" | "infinite";
export type DynamicLineInterpolation = "linear" | "log";

export interface FixedPriceTarget {
  version: 1;
  kind: "fixed-price";
  price: number;
}

export interface DynamicLineTarget {
  version: 1;
  kind: "dynamic-line";
  a: TechnicalAlertPoint;
  b: TechnicalAlertPoint;
  domain: DynamicLineDomain;
  interpolation: DynamicLineInterpolation;
}

export type ChannelAlertOperator =
  | "cross-upper-up"
  | "cross-upper-down"
  | "cross-lower-up"
  | "cross-lower-down"
  | "enter"
  | "exit"
  | "inside"
  | "outside";

export interface DynamicChannelTarget {
  version: 1;
  kind: "dynamic-channel";
  boundaryA: DynamicLineTarget;
  boundaryB: DynamicLineTarget;
  operator: ChannelAlertOperator;
}

export type TechnicalAlertTarget =
  | FixedPriceTarget
  | DynamicLineTarget
  | DynamicChannelTarget;
