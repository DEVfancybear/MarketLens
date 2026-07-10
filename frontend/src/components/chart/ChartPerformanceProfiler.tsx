"use client";

import { Profiler } from "react";
import {
  incrementChartPerformanceCounter,
  recordChartPerformanceDuration,
} from "@/services/chartPerformanceProbe";

export function ChartPerformanceProfiler({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Profiler
      id="ChartArea"
      onRender={(id, phase, actualDuration, baseDuration) => {
        incrementChartPerformanceCounter(`react.${id}.${phase}.commits`);
        recordChartPerformanceDuration("react.commit", actualDuration, {
          component: id,
          phase,
          baseDuration,
        });
      }}
    >
      {children}
    </Profiler>
  );
}
