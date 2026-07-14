"use client";

import { ObjectTreePanel } from "@/components/chart/drawing/objectTree/ObjectTreePanel";

/**
 * The object-tree operations are already a chart-domain component. Mobile uses
 * the same command/history implementation with touch density supplied by the
 * mobile wrapper instead of maintaining a second mutation path.
 */
export function MobileObjectTreeWorkspace() {
  return <div className="mobile-object-tree"><ObjectTreePanel /></div>;
}
