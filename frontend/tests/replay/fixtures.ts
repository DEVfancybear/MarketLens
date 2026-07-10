import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface FixtureBar {
  symbol?: string;
  seq?: number;
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface FixtureOrder {
  clientOrderId: string;
  symbol: string;
  side: "long" | "short";
  type: "limit" | "stop";
  entry: number;
}

export interface ReplayContractFixtures {
  schemaVersion: number;
  timeUnit: "unix_seconds";
  selectionCases: Array<{
    name: string;
    candles: number[];
    requestedTime: number;
    expectedNearestIndex: number;
    expectedAtOrBeforeIndex: number;
  }>;
  knownGaps: {
    partialMtf: {
      symbol: string;
      chartIntervalSeconds: number;
      revealedThrough: number;
      sourceFinalBar: FixtureBar;
      revealedBaseBars: FixtureBar[];
      expectedPartialBar: FixtureBar & { complete: boolean };
    };
    skippedTradeFill: {
      symbol: string;
      order: FixtureOrder;
      revealedBars: FixtureBar[];
      expectedFill: { seq: number; price: number };
    };
    rewindWithOpenPosition: {
      lastProcessedSeq: number;
      requestedSeq: number;
      hasTrades: boolean;
      expectedError: "rewind_requires_fork";
    };
    crossSymbolFill: {
      marketSymbol: string;
      orders: FixtureOrder[];
      bar: FixtureBar;
      expectedTriggeredClientOrderIds: string[];
    };
    hiddenTabResume: {
      playingBeforeDisconnect: boolean;
      elapsedWallTimeMs: number;
      speed: 0.1 | 0.3 | 0.5 | 1 | 3 | 10;
      expectedStatus: "paused";
      expectedSteps: number;
      expectedPauseReason: "no_subscribers";
    };
    unavailableTimeframe: {
      savedTime: number;
      currentCursor: number;
      newCandleTimes: number[];
      expectedError: "data_point_unavailable";
      expectedCursor: number;
    };
  };
}

const fixturePath = resolve(
  __dirname,
  "../../../..",
  "testdata/replay/contracts.v1.json",
);

export function loadReplayContractFixtures(): ReplayContractFixtures {
  return JSON.parse(
    readFileSync(fixturePath, "utf8"),
  ) as ReplayContractFixtures;
}
