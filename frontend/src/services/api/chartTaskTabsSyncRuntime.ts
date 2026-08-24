"use client";

import { getDefaultStore } from "jotai";
import { isApiError } from "@/services/api/errors";
import {
  getChartTaskTabs,
  replaceChartTaskTabs,
} from "@/services/api/resources/settingsApi";
import {
  acknowledgeChartTaskTabsAtom,
  adoptConflictedChartTaskTabsAtom,
  failChartTaskTabsSyncAtom,
} from "@/store/chartTaskTabsRuntimeStore";
import type { ChartTaskTabsDocument } from "@/store/chartTaskTabsStore";
import { pushToastAtom } from "@/store/toastStore";
import { logAtom } from "@/store/uiStore";
import { ChartTaskTabsSyncQueue } from "./chartTaskTabsSyncQueue";

const PENDING_PREFIX = "marketlens:chart-task-tabs:pending:";
const CONFLICT_PREFIX = "marketlens:chart-task-tabs:conflict:";

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function writeRecovery(
  prefix: string,
  uid: string,
  document: ChartTaskTabsDocument,
): void {
  try {
    storage()?.setItem(`${prefix}${uid}`, JSON.stringify(document));
  } catch {
    // Storage is best-effort; the in-memory queue remains authoritative.
  }
}

const store = getDefaultStore();
const queue = new ChartTaskTabsSyncQueue(
  {
    put: replaceChartTaskTabs,
    get: getChartTaskTabs,
    isConflict: (error) => isApiError(error) && error.status === 409,
  },
  {
    savePending: (uid, document) =>
      writeRecovery(PENDING_PREFIX, uid, document),
    clearPending: (uid) => {
      try {
        storage()?.removeItem(`${PENDING_PREFIX}${uid}`);
      } catch {
        // Best-effort cleanup only.
      }
    },
    saveConflict: (uid, document) =>
      writeRecovery(CONFLICT_PREFIX, uid, document),
  },
  {
    acknowledged: (document) =>
      store.set(acknowledgeChartTaskTabsAtom, document),
    conflicted: (server) => {
      store.set(adoptConflictedChartTaskTabsAtom, server);
      store.set(logAtom, "warn", "Chart task tabs changed elsewhere; latest server tabs restored");
      store.set(pushToastAtom, {
        title: "Chart tabs changed elsewhere",
        message: "The latest server order was restored. Your pending version remains in this browser session.",
        variant: "warn",
      });
    },
    failed: (error) => {
      store.set(failChartTaskTabsSyncAtom);
      store.set(
        logAtom,
        "warn",
        `Chart task tabs sync failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    },
  },
);

export function enqueueChartTaskTabs(
  uid: string,
  document: ChartTaskTabsDocument,
): void {
  queue.enqueue(uid, document);
}

export function readPendingChartTaskTabs(
  uid: string,
): ChartTaskTabsDocument | null {
  try {
    const raw = storage()?.getItem(`${PENDING_PREFIX}${uid}`);
    return raw ? (JSON.parse(raw) as ChartTaskTabsDocument) : null;
  } catch {
    return null;
  }
}

export function resetChartTaskTabsSync(uid?: string): void {
  queue.reset(uid);
  if (!uid) return;
  try {
    storage()?.removeItem(`${CONFLICT_PREFIX}${uid}`);
  } catch {
    // Best-effort identity cleanup only.
  }
}

export function flushChartTaskTabs(): Promise<void> {
  return queue.flush();
}
