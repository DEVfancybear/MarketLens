"use client";

import { useEffect, useState } from "react";
import { resolveTerminalPlatform, type TerminalPlatform } from "@/platform/platformPolicy";

function readPlatform(): TerminalPlatform {
  if (typeof window === "undefined") return "desktop";
  return resolveTerminalPlatform({
    width: window.innerWidth,
    coarsePointer: window.matchMedia("(pointer: coarse)").matches,
  });
}

export function useTerminalPlatform(): TerminalPlatform {
  const [platform, setPlatform] = useState<TerminalPlatform>(readPlatform);

  useEffect(() => {
    const pointer = window.matchMedia("(pointer: coarse)");
    const update = () => setPlatform(readPlatform());
    pointer.addEventListener("change", update);
    window.addEventListener("resize", update, { passive: true });
    window.visualViewport?.addEventListener("resize", update, { passive: true });
    return () => {
      pointer.removeEventListener("change", update);
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);

  return platform;
}
