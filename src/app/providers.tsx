"use client";

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { themeAtom } from "@/store/uiStore";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
        },
      }),
  );
  const theme = useAtomValue(themeAtom);

  // Sync the persisted theme onto <html> on mount and whenever it changes.
  useEffect(() => {
    document.documentElement.className = `theme-${theme}`;
  }, [theme]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
